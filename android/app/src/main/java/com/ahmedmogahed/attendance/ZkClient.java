package com.ahmedmogahed.attendance;

import java.io.ByteArrayOutputStream;
import java.io.EOFException;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.net.Socket;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * عميل بسيط لبروتوكول أجهزة ZKTeco على TCP (بورت 4370).
 * بيقرأ بس: معلومات الجهاز، المستخدمين، سجل البصمات، والساعة — ومبيمسحش أي حاجة من الجهاز.
 * مبني على نفس منطق مكتبة pyzk (GPL) المجرّبة على أجهزة كتير.
 */
public class ZkClient {
    static final int USHRT_MAX = 65535;
    static final int CMD_CONNECT = 1000, CMD_EXIT = 1001, CMD_AUTH = 1102, CMD_GET_VERSION = 1100;
    static final int CMD_ACK_OK = 2000, CMD_ACK_UNAUTH = 2005, CMD_PREPARE_DATA = 1500, CMD_DATA = 1501, CMD_FREE_DATA = 1502;
    static final int CMD_PREPARE_BUFFER = 1503, CMD_READ_BUFFER = 1504;
    static final int CMD_OPTIONS_RRQ = 11, CMD_ATTLOG_RRQ = 13, CMD_USERTEMP_RRQ = 9, CMD_GET_FREE_SIZES = 50;
    static final int CMD_GET_TIME = 201, CMD_SET_TIME = 202, CMD_REFRESHDATA = 1013;
    static final int FCT_USER = 5;
    static final int MAX_CHUNK = 0xFFC0;

    public static class Punch { public String userId; public String time; public int punch; public int verify; }
    public static class User { public int uid; public String userId; public String name; }
    public static class Sizes { public int users, fingers, records, usersCap, recCap; }

    private final String host; private final int port; private final int password; private final int timeoutMs;
    private Socket sock; private InputStream in; private OutputStream out;
    private int sessionId = 0, replyId = USHRT_MAX - 1;
    private int lastCmd; private byte[] lastData = new byte[0];

    public ZkClient(String host, int port, int password, int timeoutMs) { this.host = host; this.port = port; this.password = password; this.timeoutMs = timeoutMs; }

    /* ---------- packets ---------- */
    static int checksum(byte[] p) {
        long c = 0; int i = 0;
        for (; i + 1 < p.length; i += 2) { c += (p[i] & 0xFF) | ((p[i + 1] & 0xFF) << 8); if (c > USHRT_MAX) c -= USHRT_MAX; }
        if (i < p.length) c += p[p.length - 1] & 0xFF;
        while (c > USHRT_MAX) c -= USHRT_MAX;
        long k = ~c; while (k < 0) k += USHRT_MAX;
        return (int) (k & 0xFFFF);
    }
    private byte[] header(int cmd, byte[] data) {
        ByteBuffer b = ByteBuffer.allocate(8 + data.length).order(ByteOrder.LITTLE_ENDIAN);
        b.putShort((short) cmd).putShort((short) 0).putShort((short) sessionId).putShort((short) replyId).put(data);
        int cs = checksum(b.array());
        int rid = replyId + 1; if (rid >= USHRT_MAX) rid -= USHRT_MAX;
        b.putShort(2, (short) cs); b.putShort(6, (short) rid);
        return b.array();
    }
    private void send(int cmd, byte[] data) throws IOException {
        byte[] pkt = header(cmd, data);
        ByteBuffer top = ByteBuffer.allocate(8 + pkt.length).order(ByteOrder.LITTLE_ENDIAN);
        top.putShort((short) 0x5050).putShort((short) 0x7D82).putInt(pkt.length).put(pkt);
        out.write(top.array()); out.flush();
    }
    private void readFully(byte[] b) throws IOException { int o = 0; while (o < b.length) { int n = in.read(b, o, b.length - o); if (n < 0) throw new EOFException("الجهاز قفل الاتصال"); o += n; } }
    /** بيقرا باكيت كاملة: بترجع [cmd, ...] وبتحط الداتا في lastData */
    private int readPacket() throws IOException {
        byte[] top = new byte[8]; readFully(top);
        ByteBuffer t = ByteBuffer.wrap(top).order(ByteOrder.LITTLE_ENDIAN);
        if ((t.getShort(0) & 0xFFFF) != 0x5050 || (t.getShort(2) & 0xFFFF) != 0x7D82) throw new IOException("رد غريب من الجهاز (مش بروتوكول ZK)");
        int len = t.getInt(4); if (len < 8 || len > 16 * 1024 * 1024) throw new IOException("طول باكيت غلط " + len);
        byte[] body = new byte[len]; readFully(body);
        ByteBuffer h = ByteBuffer.wrap(body).order(ByteOrder.LITTLE_ENDIAN);
        lastCmd = h.getShort(0) & 0xFFFF; replyId = h.getShort(6) & 0xFFFF;
        int sid = h.getShort(4) & 0xFFFF; if (sessionId == 0) sessionId = sid;
        lastData = new byte[len - 8]; System.arraycopy(body, 8, lastData, 0, len - 8);
        return lastCmd;
    }
    private int command(int cmd, byte[] data) throws IOException { send(cmd, data); return readPacket(); }
    private static boolean ok(int c) { return c == CMD_ACK_OK || c == CMD_PREPARE_DATA || c == CMD_DATA; }

    static byte[] commKey(int key, int session) {
        long k = 0;
        for (int i = 0; i < 32; i++) k = ((key & (1L << i)) != 0) ? (k << 1 | 1) : (k << 1);
        k = (k + session) & 0xFFFFFFFFL;
        byte[] b = { (byte) (k & 0xFF), (byte) ((k >> 8) & 0xFF), (byte) ((k >> 16) & 0xFF), (byte) ((k >> 24) & 0xFF) };
        b[0] ^= 'Z'; b[1] ^= 'K'; b[2] ^= 'S'; b[3] ^= 'O';
        byte[] s = { b[2], b[3], b[0], b[1] }; // swap the two 16-bit halves
        byte B = (byte) 50;
        return new byte[] { (byte) (s[0] ^ B), (byte) (s[1] ^ B), B, (byte) (s[3] ^ B) };
    }

    /* ---------- session ---------- */
    public void connect() throws IOException {
        sock = new Socket();
        sock.connect(new InetSocketAddress(host, port), timeoutMs);
        sock.setSoTimeout(Math.max(timeoutMs, 8000));
        in = sock.getInputStream(); out = sock.getOutputStream();
        sessionId = 0; replyId = USHRT_MAX - 1;
        int c = command(CMD_CONNECT, new byte[0]);
        if (c == CMD_ACK_UNAUTH) c = command(CMD_AUTH, commKey(password, sessionId));
        if (c == CMD_ACK_UNAUTH) throw new IOException("AUTH: كلمة سر الاتصال غلط");
        if (!ok(c)) throw new IOException("الجهاز رفض الاتصال (" + c + ")");
    }
    public void close() {
        try { if (sock != null && sock.isConnected()) command(CMD_EXIT, new byte[0]); } catch (Exception ignored) { }
        try { if (sock != null) sock.close(); } catch (Exception ignored) { }
    }

    /* ---------- info ---------- */
    private static String cstr(byte[] d, int off, int len) {
        int end = off; while (end < off + len && end < d.length && d[end] != 0) end++;
        return new String(d, off, end - off, StandardCharsets.UTF_8).trim();
    }
    public String option(String name) throws IOException {
        int c = command(CMD_OPTIONS_RRQ, (name + "\0").getBytes(StandardCharsets.US_ASCII));
        if (!ok(c)) return "";
        String s = cstr(lastData, 0, lastData.length); int i = s.indexOf('=');
        return i >= 0 ? s.substring(i + 1) : s;
    }
    public String firmware() throws IOException { int c = command(CMD_GET_VERSION, new byte[0]); return ok(c) ? cstr(lastData, 0, lastData.length) : ""; }
    public Sizes sizes() throws IOException {
        int c = command(CMD_GET_FREE_SIZES, new byte[0]);
        if (!ok(c)) throw new IOException("مقدرتش أقرا عدد البصمات");
        Sizes s = new Sizes();
        if (lastData.length >= 80) {
            ByteBuffer b = ByteBuffer.wrap(lastData).order(ByteOrder.LITTLE_ENDIAN);
            s.users = b.getInt(4 * 4); s.fingers = b.getInt(6 * 4); s.records = b.getInt(8 * 4);
            s.usersCap = b.getInt(15 * 4); s.recCap = b.getInt(16 * 4);
        }
        return s;
    }
    static long encodeTime(int y, int mo, int d, int h, int mi, int s) { return ((long) ((y % 100) * 12 * 31 + (mo - 1) * 31 + d - 1)) * 86400L + (h * 60L + mi) * 60L + s; }
    static String decodeTime(long t) {
        int sec = (int) (t % 60); t /= 60; int min = (int) (t % 60); t /= 60; int hr = (int) (t % 24); t /= 24;
        int day = (int) (t % 31) + 1; t /= 31; int mon = (int) (t % 12) + 1; t /= 12; int yr = (int) t + 2000;
        return String.format(java.util.Locale.US, "%04d-%02d-%02d %02d:%02d:%02d", yr, mon, day, hr, min, sec);
    }
    public String getTime() throws IOException {
        int c = command(CMD_GET_TIME, new byte[0]);
        if (!ok(c) || lastData.length < 4) return "";
        return decodeTime(ByteBuffer.wrap(lastData).order(ByteOrder.LITTLE_ENDIAN).getInt(0) & 0xFFFFFFFFL);
    }
    public boolean setTime(int y, int mo, int d, int h, int mi, int s) throws IOException {
        byte[] b = ByteBuffer.allocate(4).order(ByteOrder.LITTLE_ENDIAN).putInt((int) encodeTime(y, mo, d, h, mi, s)).array();
        boolean r = ok(command(CMD_SET_TIME, b));
        try { command(CMD_REFRESHDATA, new byte[0]); } catch (Exception ignored) { }
        return r;
    }

    /* ---------- buffered reads ---------- */
    private byte[] readChunk(int start, int size) throws IOException {
        IOException last = null;
        for (int attempt = 0; attempt < 3; attempt++) {
            try {
                byte[] cs = ByteBuffer.allocate(8).order(ByteOrder.LITTLE_ENDIAN).putInt(start).putInt(size).array();
                int c = command(CMD_READ_BUFFER, cs);
                if (c == CMD_DATA) return lastData;
                if (c == CMD_PREPARE_DATA) {
                    int total = ByteBuffer.wrap(lastData).order(ByteOrder.LITTLE_ENDIAN).getInt(0);
                    ByteArrayOutputStream acc = new ByteArrayOutputStream(total);
                    while (true) {
                        int r = readPacket();
                        if (r == CMD_DATA) acc.write(lastData);
                        else if (r == CMD_ACK_OK) break;
                        else throw new IOException("رد غير متوقع أثناء القراية " + r);
                    }
                    return acc.toByteArray();
                }
                throw new IOException("الجهاز رفض قراية الجزء (" + c + ")");
            } catch (IOException e) { last = e; }
        }
        throw last;
    }
    public byte[] readWithBuffer(int cmd, int fct, int ext) throws IOException {
        byte[] cs = ByteBuffer.allocate(11).order(ByteOrder.LITTLE_ENDIAN).put((byte) 1).putShort((short) cmd).putInt(fct).putInt(ext).array();
        int c = command(CMD_PREPARE_BUFFER, cs);
        if (!ok(c)) throw new IOException("الجهاز مش بيدعم القراية المجمّعة (" + c + ")");
        if (c == CMD_DATA) return lastData;
        int size = ByteBuffer.wrap(lastData).order(ByteOrder.LITTLE_ENDIAN).getInt(1);
        ByteArrayOutputStream all = new ByteArrayOutputStream(Math.max(size, 0));
        int start = 0;
        while (start < size) { int n = Math.min(MAX_CHUNK, size - start); all.write(readChunk(start, n)); start += n; }
        try { command(CMD_FREE_DATA, new byte[0]); } catch (Exception ignored) { }
        return all.toByteArray();
    }

    /* ---------- users / attendance ---------- */
    public List<User> users(Sizes s) throws IOException {
        List<User> list = new ArrayList<>();
        if (s.users <= 0) return list;
        byte[] d = readWithBuffer(CMD_USERTEMP_RRQ, FCT_USER, 0);
        if (d.length <= 4) return list;
        ByteBuffer b = ByteBuffer.wrap(d).order(ByteOrder.LITTLE_ENDIAN);
        int total = b.getInt(0); int ps = total / s.users;
        if (ps != 28 && ps != 72) ps = (total % 72 == 0) ? 72 : 28;
        for (int o = 4; o + ps <= d.length; o += ps) {
            User u = new User(); u.uid = b.getShort(o) & 0xFFFF;
            if (ps == 28) { u.name = cstr(d, o + 8, 8); u.userId = String.valueOf(b.getInt(o + 24) & 0xFFFFFFFFL); }
            else { u.name = cstr(d, o + 11, 24); u.userId = cstr(d, o + 48, 24); }
            list.add(u);
        }
        return list;
    }
    public List<Punch> attendance(Sizes s, List<User> users) throws IOException {
        List<Punch> list = new ArrayList<>();
        if (s.records <= 0) return list;
        byte[] d = readWithBuffer(CMD_ATTLOG_RRQ, 0, 0);
        if (d.length < 4) return list;
        ByteBuffer b = ByteBuffer.wrap(d).order(ByteOrder.LITTLE_ENDIAN);
        int total = b.getInt(0); int rs = total / s.records;
        if (rs != 8 && rs != 16 && rs != 40) rs = (total % 40 == 0) ? 40 : (total % 16 == 0 ? 16 : 8);
        Map<Integer, String> byUid = new HashMap<>(); for (User u : users) byUid.put(u.uid, u.userId);
        for (int o = 4; o + rs <= d.length; o += rs) {
            Punch p = new Punch();
            if (rs == 8) {
                int uid = b.getShort(o) & 0xFFFF; p.userId = byUid.containsKey(uid) ? byUid.get(uid) : String.valueOf(uid);
                p.verify = d[o + 2] & 0xFF; p.time = decodeTime(b.getInt(o + 3) & 0xFFFFFFFFL); p.punch = d[o + 7] & 0xFF;
            } else if (rs == 16) {
                p.userId = String.valueOf(b.getInt(o) & 0xFFFFFFFFL); p.time = decodeTime(b.getInt(o + 4) & 0xFFFFFFFFL);
                p.verify = d[o + 8] & 0xFF; p.punch = d[o + 9] & 0xFF;
            } else {
                p.userId = cstr(d, o + 2, 24); p.verify = d[o + 26] & 0xFF;
                p.time = decodeTime(b.getInt(o + 27) & 0xFFFFFFFFL); p.punch = d[o + 31] & 0xFF;
            }
            list.add(p);
        }
        return list;
    }
}
