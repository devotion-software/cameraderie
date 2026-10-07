package dev.joeherbert.cameraderie.ui.detail

import android.app.DownloadManager
import android.content.Context
import android.net.Uri
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Download
import androidx.compose.material.icons.filled.Favorite
import androidx.compose.material.icons.filled.FavoriteBorder
import androidx.compose.material.icons.filled.Flag
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.media3.common.MediaItem
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.ui.PlayerView
import coil.compose.AsyncImage
import dev.joeherbert.cameraderie.data.auth.AuthRepository
import dev.joeherbert.cameraderie.data.media.MediaRepository

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun DetailScreen(
    mediaId: String,
    mediaRepository: MediaRepository,
    authRepository: AuthRepository,
    onBack: () -> Unit,
) {
    val viewModel: DetailViewModel = viewModel(
        factory = DetailViewModel.Factory(mediaId, mediaRepository, authRepository)
    )
    val state by viewModel.uiState.collectAsState()
    val context = LocalContext.current

    var showReportDialog by remember { mutableStateOf(false) }
    var showDeleteDialog by remember { mutableStateOf(false) }

    LaunchedEffect(state.deleted) {
        if (state.deleted) onBack()
    }

    LaunchedEffect(state.pendingDownload) {
        state.pendingDownload?.let { download ->
            enqueueSystemDownload(context, download.url, download.filename)
            viewModel.consumeDownload()
        }
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(state.media?.filename ?: "Media") },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back")
                    }
                },
                actions = {
                    IconButton(onClick = viewModel::toggleFavourite, enabled = state.media != null) {
                        Icon(
                            if (state.media?.favourited == true) Icons.Filled.Favorite else Icons.Filled.FavoriteBorder,
                            contentDescription = "Favourite",
                            tint = if (state.media?.favourited == true) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurface,
                        )
                    }
                    IconButton(onClick = viewModel::requestDownload, enabled = state.media != null) {
                        Icon(Icons.Filled.Download, contentDescription = "Download original")
                    }
                    IconButton(onClick = { showReportDialog = true }, enabled = state.media != null) {
                        Icon(Icons.Filled.Flag, contentDescription = "Report")
                    }
                    if (state.canDelete) {
                        IconButton(onClick = { showDeleteDialog = true }) {
                            Icon(Icons.Filled.Delete, contentDescription = "Delete")
                        }
                    }
                },
            )
        },
    ) { padding ->
        Box(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding),
            contentAlignment = Alignment.Center,
        ) {
            when {
                state.isLoading && state.media == null -> CircularProgressIndicator()
                state.error != null && state.media == null -> Text(
                    text = state.error ?: "Something went wrong",
                    color = MaterialTheme.colorScheme.error,
                    modifier = Modifier.padding(16.dp),
                )
                state.media != null -> {
                    val media = state.media!!
                    Column(
                        modifier = Modifier.fillMaxSize(),
                        verticalArrangement = Arrangement.Center,
                    ) {
                        if (media.kind == "video" && media.previewUrl != null) {
                            VideoPreview(url = media.previewUrl)
                        } else if (media.previewUrl != null) {
                            AsyncImage(
                                model = media.previewUrl,
                                contentDescription = media.filename,
                                modifier = Modifier.fillMaxSize(),
                            )
                        } else {
                            Text(
                                "Preview not available (state: ${media.state})",
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .padding(16.dp),
                            )
                        }
                        Text(
                            text = "${media.favouriteCount} favourite${if (media.favouriteCount == 1) "" else "s"}",
                            modifier = Modifier.padding(8.dp),
                        )
                    }
                }
            }
        }
    }

    if (showReportDialog) {
        ReportDialog(
            onDismiss = { showReportDialog = false },
            onSubmit = { reason ->
                viewModel.report(reason)
                showReportDialog = false
            },
        )
    }

    if (showDeleteDialog) {
        AlertDialog(
            onDismissRequest = { showDeleteDialog = false },
            title = { Text("Delete media?") },
            text = { Text("This cannot be undone.") },
            confirmButton = {
                TextButton(onClick = {
                    showDeleteDialog = false
                    viewModel.delete()
                }) { Text("Delete") }
            },
            dismissButton = {
                TextButton(onClick = { showDeleteDialog = false }) { Text("Cancel") }
            },
        )
    }
}

@Composable
private fun VideoPreview(url: String) {
    val context = LocalContext.current
    val exoPlayer = remember(url) {
        ExoPlayer.Builder(context).build().apply {
            setMediaItem(MediaItem.fromUri(Uri.parse(url)))
            prepare()
        }
    }
    val latestPlayer = rememberUpdatedState(exoPlayer)

    DisposableEffect(exoPlayer) {
        onDispose { latestPlayer.value.release() }
    }

    AndroidView(
        modifier = Modifier
            .fillMaxWidth()
            .height(300.dp),
        factory = { ctx ->
            PlayerView(ctx).apply { player = exoPlayer }
        },
    )
}

@Composable
private fun ReportDialog(onDismiss: () -> Unit, onSubmit: (String) -> Unit) {
    var reason by remember { mutableStateOf("") }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Report media") },
        text = {
            OutlinedTextField(
                value = reason,
                onValueChange = { reason = it },
                label = { Text("Reason") },
                modifier = Modifier.fillMaxWidth(),
            )
        },
        confirmButton = {
            TextButton(onClick = { onSubmit(reason) }, enabled = reason.isNotBlank()) { Text("Submit") }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) { Text("Cancel") }
        },
    )
}

private fun enqueueSystemDownload(context: Context, url: String, filename: String) {
    val request = DownloadManager.Request(Uri.parse(url))
        .setTitle(filename)
        .setDestinationInExternalFilesDir(context, null, filename)
        .setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
    val manager = context.getSystemService(Context.DOWNLOAD_SERVICE) as DownloadManager
    manager.enqueue(request)
}
