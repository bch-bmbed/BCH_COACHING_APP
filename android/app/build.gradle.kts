plugins { id("com.android.application"); id("org.jetbrains.kotlin.android") }
android {
    namespace = "fr.bmbed.equilibre.connect"
    compileSdk = 36
    defaultConfig {
        applicationId = "fr.bmbed.equilibre.connect"
        minSdk = 28
        targetSdk = 35
        versionCode = (System.getenv("BUILD_NUMBER") ?: "1").toInt()
        versionName = "1.0.${System.getenv("BUILD_NUMBER") ?: "1"}"
    }
    signingConfigs {
        create("release") {
            storeFile = file("../release.jks")
            storePassword = System.getenv("SIGNING_PASSWORD")
            keyAlias = "equilibre"
            keyPassword = System.getenv("SIGNING_PASSWORD")
        }
    }
    buildTypes { getByName("release") { signingConfig = signingConfigs.getByName("release"); isMinifyEnabled = false } }
    compileOptions { sourceCompatibility = JavaVersion.VERSION_17; targetCompatibility = JavaVersion.VERSION_17 }
    kotlinOptions { jvmTarget = "17" }
}
dependencies {
    implementation("androidx.activity:activity-ktx:1.10.1")
    implementation("androidx.health.connect:connect-client:1.1.0")
    implementation("androidx.work:work-runtime-ktx:2.10.1")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.10.2")
    testImplementation("junit:junit:4.13.2")
}
