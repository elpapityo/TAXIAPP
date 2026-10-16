plugins {
  id("com.android.application")
  id("org.jetbrains.kotlin.android")
}
android {
  namespace = "jp.taxiapp.dailyapp"
  compileSdk = 35
  defaultConfig {
    applicationId = "jp.taxiapp.dailyapp"
    minSdk = 26
    targetSdk = 35
    versionCode = 1
    versionName = "0.1.0-pilot"
  }
  compileOptions {
    sourceCompatibility = JavaVersion.VERSION_17
    targetCompatibility = JavaVersion.VERSION_17
  }
  kotlinOptions { jvmTarget = "17" }
}
dependencies {
  implementation(project(":core"))
  implementation("androidx.webkit:webkit:1.12.1")
}
