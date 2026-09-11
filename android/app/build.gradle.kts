plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.compose)
}

android {
    namespace = "com.example.basaltsurgemobile"
    compileSdk = 36

    defaultConfig {
        applicationId = "com.example.basaltsurgemobile"
        minSdk = 24
        targetSdk = 36
        // Read version from project properties (passed from CI/CD)
        // Use toString() to ensure safe conversion regardless of type
        val vCode = project.findProperty("VERSION_CODE")?.toString()?.toIntOrNull() ?: 31
        val vName = project.findProperty("VERSION_NAME")?.toString() ?: "0.0.31"
        
        // Print for build log verification
        println("AppConfig: Building with VersionCode: $vCode, VersionName: $vName")
        
        versionCode = vCode
        versionName = vName

        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"

        buildFeatures.buildConfig = true

        // Dynamic URL
        val baseDomain = project.findProperty("BASE_DOMAIN") as? String ?: "https://surge.basalthq.com"
        buildConfigField("String", "BASE_DOMAIN", "\"$baseDomain\"")

        // Dynamic App Name
        val appName = project.findProperty("APP_NAME") as? String ?: "BasaltSurge"
        resValue("string", "app_name", appName)
    }

    signingConfigs {
        create("release") {
            storeFile = System.getenv("KEYSTORE_FILE_PATH")?.let { file(it) } ?: file("keystore.jks")
            storePassword = System.getenv("KEYSTORE_PASSWORD") ?: "android"
            keyAlias = System.getenv("KEY_ALIAS") ?: "androidreleasekey"
            keyPassword = System.getenv("KEY_PASSWORD") ?: "android"
            enableV1Signing = true
            enableV2Signing = true
        }
    }

    buildTypes {
        release {
            signingConfig = signingConfigs.getByName("release")
            isMinifyEnabled = false
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro"
            )
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_21
        targetCompatibility = JavaVersion.VERSION_21
    }
    buildFeatures {
        compose = true
        resValues = true
    }
}

dependencies {
    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.lifecycle.runtime.ktx)
    implementation(libs.androidx.activity.compose)
    implementation(platform(libs.androidx.compose.bom))
    implementation(libs.androidx.compose.ui)
    implementation(libs.androidx.compose.ui.graphics)
    implementation(libs.androidx.compose.ui.tooling.preview)
    implementation(libs.androidx.compose.material3)
    // Capacitor and local SDKs
    implementation(project(":capacitor-android"))
    implementation(fileTree("libs") {
        include("*.jar", "*.aar")
    })
    
    // Capacitor requires AppCompat and CoordinatorLayout
    implementation("androidx.appcompat:appcompat:1.6.1")
    implementation("androidx.coordinatorlayout:coordinatorlayout:1.2.0")
    implementation("androidx.core:core-splashscreen:1.0.0")
    
    // Required for third-party native AARs using Material Components UI (Valor SDK)
    implementation("com.google.android.material:material:1.11.0")
    // ZXing core for native QR code generation on secondary display
    implementation("com.google.zxing:core:3.5.3")
    testImplementation(libs.junit)
    androidTestImplementation(libs.androidx.junit)
    androidTestImplementation(libs.androidx.espresso.core)
    androidTestImplementation(platform(libs.androidx.compose.bom))
    androidTestImplementation(libs.androidx.compose.ui.test.junit4)
    debugImplementation(libs.androidx.compose.ui.tooling)
    debugImplementation(libs.androidx.compose.ui.test.manifest)
}