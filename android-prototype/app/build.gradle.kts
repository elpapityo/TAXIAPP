plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}
android {
    namespace = "jp.taxiapp.gpsprototype"
    compileSdk = 35
    defaultConfig {
        applicationId = "jp.taxiapp.gpsprototype.distancelabv131"
        minSdk = 26
        targetSdk = 35
        versionCode = 2
        versionName = "1.3.2-ui-test"
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
}
dependencies { implementation(project(":core")) }
