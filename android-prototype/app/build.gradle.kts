plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}
android {
    namespace = "jp.taxiapp.gpsprototype"
    compileSdk = 35

    defaultConfig {
        // Intentionally new package identity: installs beside legacy GPS test APK.
        // Never overwrites its measurement storage or requires uninstall.
        applicationId = "jp.taxiapp.gpsprototype.loopbackv038"
        minSdk = 26
        targetSdk = 35
        versionCode = 2
        versionName = "0.3.8-loopback-test"
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
