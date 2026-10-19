plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}
android {
    namespace = "jp.taxiapp.gpsprototype"
    compileSdk = 35
    defaultConfig {
        applicationId = "jp.taxiapp.gpsprototype.distancelabv130"
        minSdk = 26
        targetSdk = 35
        versionCode = 1
        versionName = "1.3.0-diary-integration"
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
}
dependencies { implementation(project(":core")) }
