package nl.kronkelgame.fan;

import android.app.Activity;
import android.net.Uri;
import android.os.Bundle;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import java.io.InputStream;
import java.util.HashMap;
import java.util.Map;

/** Fullscreen WebView that plays the bundled web game. Files are served from assets/www on a private https origin. */
public class MainActivity extends Activity {
  static final String HOST = "appassets.androidplatform.net";
  WebView web;

  @Override
  protected void onCreate(Bundle state) {
    super.onCreate(state);
    requestWindowFeature(1); // FEATURE_NO_TITLE
    getWindow().addFlags(0x80 | 0x400); // KEEP_SCREEN_ON | FULLSCREEN
    web = new WebView(this);
    WebSettings s = web.getSettings();
    s.setJavaScriptEnabled(true);
    s.setDomStorageEnabled(true); // saves live in localStorage
    s.setMediaPlaybackRequiresUserGesture(false);
    web.setWebChromeClient(new WebChromeClient());
    web.setWebViewClient(new Assets());
    setContentView(web);
    immersive();
    web.loadUrl("https://" + HOST + "/index.html");
  }

  void immersive() {
    // LAYOUT_STABLE | LAYOUT_HIDE_NAVIGATION | LAYOUT_FULLSCREEN | HIDE_NAVIGATION | FULLSCREEN | IMMERSIVE_STICKY
    web.setSystemUiVisibility(0x100 | 0x200 | 0x400 | 0x2 | 0x4 | 0x1000);
  }

  @Override
  public void onWindowFocusChanged(boolean focus) {
    super.onWindowFocusChanged(focus);
    if (focus) immersive();
  }

  @Override
  public void onBackPressed() {
    // Android back = Esc in the game (back / pause)
    web.evaluateJavascript("window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape'}))", null);
  }

  @Override
  protected void onPause() {
    super.onPause();
    web.onPause();
  }

  @Override
  protected void onResume() {
    super.onResume();
    web.onResume();
    immersive();
  }

  class Assets extends WebViewClient {
    @Override
    public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest req) {
      Uri u = req.getUrl();
      if (!HOST.equals(u.getHost())) return null;
      String path = u.getPath();
      if (path == null || path.equals("/")) path = "/index.html";
      String type = mime(path);
      try {
        InputStream in = getAssets().open("www" + path);
        WebResourceResponse r = new WebResourceResponse(type, type.startsWith("text/") || type.endsWith("json") ? "utf-8" : null, in);
        Map<String, String> h = new HashMap<String, String>();
        h.put("Access-Control-Allow-Origin", "*");
        h.put("Cache-Control", "no-cache");
        r.setResponseHeaders(h);
        return r;
      } catch (Exception e) {
        WebResourceResponse r = new WebResourceResponse("text/plain", "utf-8", null);
        r.setStatusCodeAndReasonPhrase(404, "Not Found");
        return r;
      }
    }

    @Override
    public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest req) {
      return false;
    }
  }

  static String mime(String p) {
    String[][] map = {
      {".html", "text/html"}, {".js", "text/javascript"}, {".mjs", "text/javascript"}, {".json", "application/json"},
      {".webmanifest", "application/manifest+json"}, {".css", "text/css"}, {".svg", "image/svg+xml"},
      {".png", "image/png"}, {".jpg", "image/jpeg"}, {".glb", "model/gltf-binary"}, {".woff2", "font/woff2"},
      {".ttf", "font/ttf"}, {".wasm", "application/wasm"}, {".txt", "text/plain"},
    };
    for (String[] m : map) if (p.endsWith(m[0])) return m[1];
    return "application/octet-stream";
  }
}
