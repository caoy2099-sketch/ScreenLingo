plugins {
  id("com.android.application") version "8.8.2" apply false
  id("org.jetbrains.kotlin.android") version "2.0.21" apply false
  id("org.jetbrains.kotlin.plugin.compose") version "2.0.21" apply false
}

// Keep root build reports outside the desktop source / release preflight boundary.
layout.buildDirectory.set(layout.projectDirectory.dir("../../artifacts/android/root"))
