#!/usr/bin/env bash
# Builds dist/kronkel.apk: a fullscreen Android WebView that plays the bundled web game offline.
# Needs Java 17+ and network access to GitHub releases and Maven Central (no Android SDK required:
# the few Android classes the wrapper uses are compiled against stubs in android/stubs).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WORK="${WORK:-$ROOT/.apkbuild}"
TOOLS="$WORK/tools"
mkdir -p "$TOOLS"
fetch() { [ -s "$TOOLS/$1" ] || curl -fsSL -o "$TOOLS/$1" "$2"; }
fetch apktool.jar https://github.com/iBotPeaches/Apktool/releases/download/v2.10.0/apktool_2.10.0.jar
fetch signer.jar https://github.com/patrickfav/uber-apk-signer/releases/download/v1.3.0/uber-apk-signer-1.3.0.jar
fetch dx.jar https://repo1.maven.org/maven2/com/jakewharton/android/repackaged/dalvik-dx/9.0.0_r3/dalvik-dx-9.0.0_r3.jar

# 1. compile the wrapper activity against the stubs, then dex it
rm -rf "$WORK/stubs" "$WORK/classes" "$WORK/proj" "$WORK/out"
mkdir -p "$WORK/stubs" "$WORK/classes"
javac --release 8 -d "$WORK/stubs" $(find "$ROOT/android/stubs" -name '*.java')
javac --release 8 -cp "$WORK/stubs" -d "$WORK/classes" $(find "$ROOT/android/src" -name '*.java')

# 2. apktool project: manifest, resources, icon, the game in assets/www, classes.dex
P="$WORK/proj"
mkdir -p "$P/res/mipmap-xxxhdpi" "$P/res/mipmap-xxhdpi" "$P/assets/www/assets/fonts"
java -cp "$TOOLS/dx.jar" com.android.dx.command.Main --dex --min-sdk-version=24 --output="$P/classes.dex" "$WORK/classes"
cp "$ROOT/android/AndroidManifest.xml" "$ROOT/android/apktool.yml" "$P/"
cp -r "$ROOT/android/res/values" "$P/res/"
cp "$ROOT/icons/icon-192.png" "$P/res/mipmap-xxxhdpi/ic_launcher.png"
cp "$ROOT/icons/icon-192.png" "$P/res/mipmap-xxhdpi/ic_launcher.png"
cd "$ROOT"
cp -r index.html manifest.webmanifest sw.js icons src vendor "$P/assets/www/"
cp -r assets/models assets/images assets/layout.json assets/gamedata.json "$P/assets/www/assets/"
cp assets/fonts/*.woff2 assets/fonts/LICENSE* "$P/assets/www/assets/fonts/"

# 3. build, zipalign and sign (debug key; fine for sideloading)
java -jar "$TOOLS/apktool.jar" b "$P" -o "$WORK/unsigned.apk"
java -jar "$TOOLS/signer.jar" -a "$WORK/unsigned.apk" -o "$WORK/out" --allowResign
mkdir -p "$ROOT/dist"
cp "$WORK/out/unsigned-aligned-debugSigned.apk" "$ROOT/dist/kronkel.apk"
echo "Built $ROOT/dist/kronkel.apk"
