package dev.joeherbert.cameraderie.app

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.Surface
import androidx.compose.ui.Modifier
import dev.joeherbert.cameraderie.ui.nav.CameraderieNavGraph
import dev.joeherbert.cameraderie.ui.theme.CameraderieTheme

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()

        val container = (application as CameraderieApp).container

        setContent {
            CameraderieTheme {
                Surface(modifier = Modifier.fillMaxSize()) {
                    CameraderieNavGraph(container = container)
                }
            }
        }
    }
}
