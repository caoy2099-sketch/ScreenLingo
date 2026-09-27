package io.screenlingo.mobile.ui

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Shapes
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

private val LightColors = lightColorScheme(
  primary = Color(0xFF6857D9),
  onPrimary = Color.White,
  primaryContainer = Color(0xFFECE8FF),
  onPrimaryContainer = Color(0xFF332572),
  secondary = Color(0xFF615C76),
  secondaryContainer = Color(0xFFECE8F4),
  onSecondaryContainer = Color(0xFF2E293E),
  background = Color(0xFFF8F7FC),
  onBackground = Color(0xFF222034),
  surface = Color(0xFFFCFBFF),
  onSurface = Color(0xFF222034),
  surfaceVariant = Color(0xFFEAE7F1),
  onSurfaceVariant = Color(0xFF605C6E),
  outline = Color(0xFF7B758B),
  outlineVariant = Color(0xFFDFDBE8),
)

private val DarkColors = darkColorScheme(
  primary = Color(0xFFC7BEFF),
  onPrimary = Color(0xFF302264),
  primaryContainer = Color(0xFF493B87),
  onPrimaryContainer = Color(0xFFECE8FF),
  secondary = Color(0xFFCBC3DE),
  secondaryContainer = Color(0xFF454052),
  onSecondaryContainer = Color(0xFFECE8F4),
  background = Color(0xFF15131D),
  onBackground = Color(0xFFEAE5F4),
  surface = Color(0xFF1D1A27),
  onSurface = Color(0xFFEAE5F4),
  surfaceVariant = Color(0xFF383342),
  onSurfaceVariant = Color(0xFFCBC4D6),
  outline = Color(0xFF9690A3),
  outlineVariant = Color(0xFF484251),
)

private val MobileTypography = Typography(
  headlineLarge = TextStyle(fontFamily = FontFamily.SansSerif, fontWeight = FontWeight.Bold, fontSize = 32.sp, lineHeight = 44.sp, letterSpacing = (-0.5).sp),
  headlineMedium = TextStyle(fontFamily = FontFamily.SansSerif, fontWeight = FontWeight.Bold, fontSize = 27.sp, lineHeight = 37.sp),
  titleLarge = TextStyle(fontFamily = FontFamily.SansSerif, fontWeight = FontWeight.SemiBold, fontSize = 21.sp, lineHeight = 30.sp),
  titleMedium = TextStyle(fontFamily = FontFamily.SansSerif, fontWeight = FontWeight.SemiBold, fontSize = 16.sp, lineHeight = 25.sp),
  bodyLarge = TextStyle(fontFamily = FontFamily.SansSerif, fontSize = 16.sp, lineHeight = 26.sp),
  bodyMedium = TextStyle(fontFamily = FontFamily.SansSerif, fontSize = 14.sp, lineHeight = 23.sp),
  labelLarge = TextStyle(fontFamily = FontFamily.SansSerif, fontWeight = FontWeight.Medium, fontSize = 14.sp, lineHeight = 22.sp),
)

@Composable
fun ScreenLingoTheme(content: @Composable () -> Unit) {
  MaterialTheme(
    colorScheme = if (isSystemInDarkTheme()) DarkColors else LightColors,
    typography = MobileTypography,
    shapes = Shapes(
      small = RoundedCornerShape(12.dp),
      medium = RoundedCornerShape(18.dp),
      large = RoundedCornerShape(24.dp),
      extraLarge = RoundedCornerShape(28.dp),
    ),
    content = content,
  )
}
