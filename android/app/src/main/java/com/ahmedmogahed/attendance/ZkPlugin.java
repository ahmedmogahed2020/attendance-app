package com.ahmedmogahed.attendance;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/** جسر بين التطبيق وجهاز البصمة (ZKTeco) على الشبكة المحلية */
@CapacitorPlugin(name = "Zk")
public class ZkPlugin extends Plugin {
    private final ExecutorService pool = Executors.newSingleThreadExecutor();

    private ZkClient client(PluginCall call) {
        String ip = call.getString("ip", "");
        int port = call.getInt("port", 4370);
        int pw = 0; try { pw = Integer.parseInt(call.getString("password", "0").trim().isEmpty() ? "0" : call.getString("password", "0").trim()); } catch (Exception ignored) { }
        return new ZkClient(ip, port, pw, call.getInt("timeout", 4000));
    }
    private static String why(Exception e) {
        String m = e.getMessage() == null ? e.getClass().getSimpleName() : e.getMessage();
        if (e instanceof java.net.SocketTimeoutException || m.contains("timed out")) return "TIMEOUT";
        if (e instanceof java.net.ConnectException || m.contains("ECONNREFUSED") || m.contains("EHOSTUNREACH") || m.contains("ENETUNREACH")) return "UNREACHABLE";
        return m;
    }

    @PluginMethod
    public void info(PluginCall call) {
        pool.execute(() -> {
            ZkClient z = client(call);
            try {
                long t0 = System.currentTimeMillis();
                z.connect();
                JSObject r = new JSObject();
                r.put("ms", System.currentTimeMillis() - t0);
                try { r.put("name", z.option("~DeviceName")); } catch (Exception ignored) { }
                try { r.put("serial", z.option("~SerialNumber")); } catch (Exception ignored) { }
                try { r.put("platform", z.option("~Platform")); } catch (Exception ignored) { }
                try { r.put("firmware", z.firmware()); } catch (Exception ignored) { }
                try { r.put("time", z.getTime()); } catch (Exception ignored) { }
                ZkClient.Sizes s = z.sizes();
                r.put("users", s.users); r.put("records", s.records); r.put("recCap", s.recCap); r.put("fingers", s.fingers);
                call.resolve(r);
            } catch (Exception e) { call.reject(why(e)); }
            finally { z.close(); }
        });
    }

    @PluginMethod
    public void pull(PluginCall call) {
        final String from = call.getString("from", "");
        pool.execute(() -> {
            ZkClient z = client(call);
            try {
                z.connect();
                String time = ""; try { time = z.getTime(); } catch (Exception ignored) { }
                ZkClient.Sizes s = z.sizes();
                List<ZkClient.User> users = z.users(s);
                List<ZkClient.Punch> ps = z.attendance(s, users);
                JSArray ua = new JSArray();
                for (ZkClient.User u : users) { JSObject o = new JSObject(); o.put("id", u.userId); o.put("name", u.name); o.put("uid", u.uid); ua.put(o); }
                StringBuilder sb = new StringBuilder(ps.size() * 28);
                int kept = 0;
                for (ZkClient.Punch p : ps) {
                    if (!from.isEmpty() && p.time.compareTo(from) < 0) continue;
                    sb.append(p.userId).append('|').append(p.time).append('|').append(p.punch).append('\n'); kept++;
                }
                JSObject r = new JSObject();
                r.put("users", ua); r.put("lines", sb.toString()); r.put("total", ps.size()); r.put("kept", kept); r.put("time", time);
                call.resolve(r);
            } catch (Exception e) { call.reject(why(e)); }
            finally { z.close(); }
        });
    }

    @PluginMethod
    public void setTime(PluginCall call) {
        pool.execute(() -> {
            ZkClient z = client(call);
            try {
                z.connect();
                boolean ok = z.setTime(call.getInt("y"), call.getInt("mo"), call.getInt("d"), call.getInt("h"), call.getInt("mi"), call.getInt("s"));
                JSObject r = new JSObject(); r.put("ok", ok); r.put("time", z.getTime());
                call.resolve(r);
            } catch (Exception e) { call.reject(why(e)); }
            finally { z.close(); }
        });
    }
}
