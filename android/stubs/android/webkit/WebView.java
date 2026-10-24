package android.webkit;
public class WebView extends android.view.View {
  public WebView(android.content.Context c) {}
  public WebSettings getSettings() { return null; }
  public void setWebChromeClient(WebChromeClient c) {}
  public void setWebViewClient(WebViewClient c) {}
  public void loadUrl(String u) {}
  public void evaluateJavascript(String s, ValueCallback<String> cb) {}
  public void onPause() {}
  public void onResume() {}
}
