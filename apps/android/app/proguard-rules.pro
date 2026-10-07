# Add project specific ProGuard rules here.
# Keep kotlinx.serialization models
-keepattributes *Annotation*, InnerClasses
-dontnote kotlinx.serialization.AnnotationsKt
-keepclassmembers class dev.joeherbert.cameraderie.** {
    *** Companion;
}
-keepclasseswithmembers class dev.joeherbert.cameraderie.** {
    kotlinx.serialization.KSerializer serializer(...);
}
