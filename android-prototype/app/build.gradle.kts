plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}
android {
    namespace = "jp.taxiapp.gpsprototype"
    compileSdk = 35

    defaultConfig {
        // New package identity for v0.3.9: CI debug APK signing keys differ between runners.
        // Never overwrites its measurement storage or requires uninstall.
        applicationId = "jp.taxiapp.gpsprototype.loopbackv0310"
        minSdk = 26
        targetSdk = 35
        versionCode = 4
        versionName = "0.3.10-loopback-recovery"
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
    }
}
dependencies {
    implementation(project(":core"))
}
