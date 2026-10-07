package dev.joeherbert.cameraderie.ui.nav

import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.navigation.NavHostController
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import dev.joeherbert.cameraderie.app.AppContainer
import dev.joeherbert.cameraderie.ui.auth.AuthScreen
import dev.joeherbert.cameraderie.ui.detail.DetailScreen
import dev.joeherbert.cameraderie.ui.feed.FeedScreen
import dev.joeherbert.cameraderie.ui.groups.GroupsScreen
import java.net.URLDecoder

@Composable
fun CameraderieNavGraph(container: AppContainer) {
    val navController: NavHostController = rememberNavController()

    // TokenStore reads the encrypted prefs file synchronously at construction time
    // (see TokenStore.init), so `currentToken` is already correct the moment this
    // composable first runs — no "unknown" third state needed here.
    val isSignedIn by container.authRepository.isSignedIn.collectAsState(
        initial = container.authRepository.currentToken != null
    )
    val startDestination = if (isSignedIn) Routes.GROUPS else Routes.AUTH

    NavHost(navController = navController, startDestination = startDestination) {
        composable(Routes.AUTH) {
            AuthScreen(
                authRepository = container.authRepository,
                onAuthenticated = {
                    navController.navigate(Routes.GROUPS) {
                        popUpTo(Routes.AUTH) { inclusive = true }
                    }
                },
            )
        }

        composable(Routes.GROUPS) {
            GroupsScreen(
                groupsRepository = container.groupsRepository,
                authRepository = container.authRepository,
                onOpenGroup = { group ->
                    navController.navigate(Routes.feed(group.id, group.name))
                },
                onSignedOut = {
                    navController.navigate(Routes.AUTH) {
                        popUpTo(Routes.GROUPS) { inclusive = true }
                    }
                },
            )
        }

        composable(Routes.FEED) { backStackEntry ->
            val groupId = backStackEntry.arguments?.decodedString("groupId").orEmpty()
            val groupName = backStackEntry.arguments?.decodedString("groupName").orEmpty()
            FeedScreen(
                groupId = groupId,
                groupName = groupName,
                mediaRepository = container.mediaRepository,
                uploadRepository = container.uploadRepository,
                authRepository = container.authRepository,
                onOpenMedia = { media ->
                    navController.navigate(Routes.detail(groupId, media.id))
                },
                onBack = { navController.popBackStack() },
            )
        }

        composable(Routes.DETAIL) { backStackEntry ->
            val mediaId = backStackEntry.arguments?.decodedString("mediaId").orEmpty()
            DetailScreen(
                mediaId = mediaId,
                mediaRepository = container.mediaRepository,
                authRepository = container.authRepository,
                onBack = { navController.popBackStack() },
            )
        }
    }
}

private fun android.os.Bundle.decodedString(key: String): String? =
    getString(key)?.let { URLDecoder.decode(it, "UTF-8") }
