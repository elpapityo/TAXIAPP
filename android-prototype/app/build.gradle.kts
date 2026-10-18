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
        applicationId = "jp.taxiapp.gpsprototype.bridgeexit"
        minSdk = 26
        targetSdk = 35
        versionCode = 1
        versionName = "0.3.3-exit-stops-gps-test"
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
