package android.app;
public class Activity extends android.content.Context {
  protected void onCreate(android.os.Bundle b) {}
  protected void onPause() {}
  protected void onResume() {}
  public void onWindowFocusChanged(boolean f) {}
  public void onBackPressed() {}
  public final boolean requestWindowFeature(int f) { return true; }
  public android.view.Window getWindow() { return null; }
  public void setContentView(android.view.View v) {}
  public android.content.res.AssetManager getAssets() { return null; }
}
