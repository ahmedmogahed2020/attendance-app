package com.ahmedmogahed.attendance;

import android.Manifest;
import android.content.ContentResolver;
import android.content.ActivityNotFoundException;
import android.content.ContentValues;
import android.content.Intent;
import android.media.MediaScannerConnection;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.MediaStore;
import android.util.Base64;

import androidx.core.content.FileProvider;

import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import java.io.File;
import java.io.FileOutputStream;
import java.io.OutputStream;

/** حفظ الصور في الاستديو (ألبوم لوحده) والـ PDF في التنزيلات */
@CapacitorPlugin(name = "Saver", permissions = { @Permission(alias = "storage", strings = { Manifest.permission.WRITE_EXTERNAL_STORAGE }) })
public class SaverPlugin extends Plugin {

    @PluginMethod
    public void save(PluginCall call) {
        if (Build.VERSION.SDK_INT < 29 && getPermissionState("storage") != PermissionState.GRANTED) {
            requestPermissionForAlias("storage", call, "storagePerm");
            return;
        }
        doSave(call);
    }

    @PermissionCallback
    private void storagePerm(PluginCall call) {
        if (getPermissionState("storage") == PermissionState.GRANTED) doSave(call);
        else call.reject("PERMISSION");
    }

    private void doSave(PluginCall call) {
        String b64 = call.getString("data", ""), name = call.getString("name", "file"), mime = call.getString("mime", "image/png");
        String album = call.getString("album", "الحضور والانصراف");
        boolean image = mime.startsWith("image/");
        try {
            byte[] bytes = Base64.decode(b64, Base64.DEFAULT);
            Uri uri;
            if (Build.VERSION.SDK_INT >= 29) {
                ContentResolver cr = getContext().getContentResolver();
                ContentValues v = new ContentValues();
                v.put(MediaStore.MediaColumns.DISPLAY_NAME, name);
                v.put(MediaStore.MediaColumns.MIME_TYPE, mime);
                v.put(MediaStore.MediaColumns.RELATIVE_PATH, (image ? Environment.DIRECTORY_PICTURES : Environment.DIRECTORY_DOWNLOADS) + "/" + album);
                v.put(MediaStore.MediaColumns.IS_PENDING, 1);
                Uri coll = image ? MediaStore.Images.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY) : MediaStore.Downloads.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY);
                uri = cr.insert(coll, v);
                if (uri == null) throw new Exception("مقدرتش أعمل الملف");
                try (OutputStream os = cr.openOutputStream(uri)) { if (os == null) throw new Exception("مقدرتش أكتب الملف"); os.write(bytes); }
                v.clear(); v.put(MediaStore.MediaColumns.IS_PENDING, 0);
                cr.update(uri, v, null, null);
            } else {
                File dir = new File(Environment.getExternalStoragePublicDirectory(image ? Environment.DIRECTORY_PICTURES : Environment.DIRECTORY_DOWNLOADS), album);
                if (!dir.exists() && !dir.mkdirs()) throw new Exception("مقدرتش أعمل الفولدر");
                File f = new File(dir, name);
                try (FileOutputStream os = new FileOutputStream(f)) { os.write(bytes); }
                MediaScannerConnection.scanFile(getContext(), new String[] { f.getAbsolutePath() }, new String[] { mime }, null);
                uri = FileProvider.getUriForFile(getContext(), getContext().getPackageName() + ".fileprovider", f);
            }
            JSObject r = new JSObject();
            r.put("uri", uri.toString());
            call.resolve(r);
        } catch (Exception e) {
            call.reject(e.getMessage() == null ? "SAVE_FAILED" : e.getMessage());
        }
    }

    @PluginMethod
    public void open(PluginCall call) {
        try {
            Intent i = new Intent(Intent.ACTION_VIEW);
            i.setDataAndType(Uri.parse(call.getString("uri")), call.getString("mime", "image/png"));
            i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
            getActivity().startActivity(i);
            call.resolve();
        } catch (Exception e) {
            call.reject("NO_APP");
        }
    }

    /** يفتح واتساب (بيزنس أو العادي) على شات الموظف والصورة جاهزة — انت بس تدوس إرسال */
    @PluginMethod
    public void whatsapp(PluginCall call) {
        try {
            byte[] bytes = Base64.decode(call.getString("data", ""), Base64.DEFAULT);
            File dir = new File(getContext().getCacheDir(), "wa");
            if (!dir.exists()) dir.mkdirs();
            File f = new File(dir, call.getString("name", "slip.png"));
            try (FileOutputStream os = new FileOutputStream(f)) { os.write(bytes); }
            Uri uri = FileProvider.getUriForFile(getContext(), getContext().getPackageName() + ".fileprovider", f);
            String phone = call.getString("phone", ""), text = call.getString("text", ""), pref = call.getString("pkg", "com.whatsapp.w4b");
            String[] pkgs = "com.whatsapp".equals(pref) ? new String[] { "com.whatsapp", "com.whatsapp.w4b" } : new String[] { "com.whatsapp.w4b", "com.whatsapp" };
            for (String pkg : pkgs) {
                Intent i = new Intent(Intent.ACTION_SEND);
                i.setType(call.getString("mime", "image/png"));
                i.setPackage(pkg);
                i.putExtra(Intent.EXTRA_STREAM, uri);
                if (!text.isEmpty()) i.putExtra(Intent.EXTRA_TEXT, text);
                if (!phone.isEmpty()) i.putExtra("jid", phone + "@s.whatsapp.net");
                i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
                try {
                    getActivity().startActivity(i);
                    JSObject r = new JSObject();
                    r.put("pkg", pkg);
                    call.resolve(r);
                    return;
                } catch (ActivityNotFoundException ignored) { }
            }
            call.reject("NO_WHATSAPP");
        } catch (Exception e) {
            call.reject(e.getMessage() == null ? "FAILED" : e.getMessage());
        }
    }
}
