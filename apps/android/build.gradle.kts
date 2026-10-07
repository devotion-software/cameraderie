// Top-level build file where you can add configuration options common to all sub-projects/modules.
plugins {
    id("com.android.application") version "8.5.2" apply false
    // Kotlin 1.9.x pairs with the classic `composeOptions.kotlinCompilerExtensionVersion`
    // mechanism used in app/build.gradle.kts. If you upgrade to Kotlin 2.0+, switch to
    // the `org.jetbrains.kotlin.plugin.compose` Gradle plugin instead.
    id("org.jetbrains.kotlin.android") version "1.9.24" apply false
    id("org.jetbrains.kotlin.plugin.serialization") version "1.9.24" apply false
}
