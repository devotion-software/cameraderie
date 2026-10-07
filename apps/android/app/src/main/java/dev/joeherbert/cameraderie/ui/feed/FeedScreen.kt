package dev.joeherbert.cameraderie.ui.feed

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.GridItemSpan
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.BrokenImage
import androidx.compose.material.icons.filled.PlayCircle
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FloatingActionButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.unit.dp
import androidx.lifecycle.viewmodel.compose.viewModel
import coil.compose.AsyncImage
import dev.joeherbert.cameraderie.data.auth.AuthRepository
import dev.joeherbert.cameraderie.data.media.MediaRepository
import dev.joeherbert.cameraderie.data.network.MediaDto
import dev.joeherbert.cameraderie.data.upload.UploadRepository
import dev.joeherbert.cameraderie.data.upload.UploadWorker

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun FeedScreen(
    groupId: String,
    groupName: String,
    mediaRepository: MediaRepository,
    uploadRepository: UploadRepository,
    authRepository: AuthRepository,
    onOpenMedia: (MediaDto) -> Unit,
    onBack: () -> Unit,
) {
    val viewModel: FeedViewModel = viewModel(
        factory = FeedViewModel.Factory(groupId, mediaRepository, uploadRepository, authRepository)
    )
    val state by viewModel.uiState.collectAsState()

    val pickerLauncher = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.PickMultipleVisualMedia(MAX_PICK_ITEMS)
    ) { uris ->
        if (uris.isNotEmpty()) viewModel.uploadFiles(uris)
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(groupName) },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back")
                    }
                },
            )
        },
        floatingActionButton = {
            FloatingActionButton(onClick = {
                pickerLauncher.launch(
                    PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageAndVideo)
                )
            }) {
                Icon(Icons.Filled.Add, contentDescription = "Upload media")
            }
        },
    ) { padding ->
        Column(modifier = Modifier.padding(padding)) {
            if (state.activeUploads.isNotEmpty()) {
                UploadProgressBanner(count = state.activeUploads.size, percent = averagePercent(state))
            }

            when {
                state.isLoading && state.media.isEmpty() -> {
                    Column(
                        modifier = Modifier.fillMaxSize(),
                        verticalArrangement = Arrangement.Center,
                    ) {
                        CircularProgressIndicator(modifier = Modifier.padding(32.dp))
                    }
                }
                state.error != null && state.media.isEmpty() -> {
                    Text(
                        text = state.error ?: "Something went wrong",
                        color = MaterialTheme.colorScheme.error,
                        modifier = Modifier.padding(16.dp),
                    )
                }
                state.media.isEmpty() -> {
                    Column(
                        modifier = Modifier.fillMaxSize(),
                        verticalArrangement = Arrangement.Center,
                    ) {
                        Text(
                            "No media yet. Tap + to upload.",
                            modifier = Modifier
                                .fillMaxWidth()
                                .padding(32.dp),
                        )
                    }
                }
                else -> {
                    LazyVerticalGrid(
                        columns = GridCells.Fixed(3),
                        modifier = Modifier.fillMaxSize(),
                    ) {
                        items(state.media, key = { it.id }) { media ->
                            MediaThumbnail(media = media, onClick = { onOpenMedia(media) })
                        }
                        if (state.nextCursor != null) {
                            item(span = { GridItemSpan(maxLineSpan) }) {
                                LoadMoreRow(isLoading = state.isLoadingMore, onLoadMore = viewModel::loadMore)
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun UploadProgressBanner(count: Int, percent: Int) {
    Surface(color = MaterialTheme.colorScheme.secondaryContainer) {
        Column(modifier = Modifier.padding(12.dp)) {
            Text("Uploading $count item${if (count == 1) "" else "s"}…")
            LinearProgressIndicator(
                progress = { percent / 100f },
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(top = 6.dp),
            )
        }
    }
}

private fun averagePercent(state: FeedUiState): Int {
    val percents = state.activeUploads.map { it.progress.getInt(UploadWorker.KEY_PERCENT, 0) }
    return if (percents.isEmpty()) 0 else percents.sum() / percents.size
}

@Composable
private fun MediaThumbnail(media: MediaDto, onClick: () -> Unit) {
    Box(
        modifier = Modifier
            .aspectRatio(1f)
            .padding(1.dp)
            .clickable(onClick = onClick),
    ) {
        when {
            media.state == "ready" && media.thumbnailUrl != null -> {
                AsyncImage(
                    model = media.thumbnailUrl,
                    contentDescription = media.filename,
                    contentScale = ContentScale.Crop,
                    modifier = Modifier.fillMaxSize(),
                )
                if (media.kind == "video") {
                    Icon(
                        imageVector = Icons.Filled.PlayCircle,
                        contentDescription = "Video",
                        tint = Color.White,
                        modifier = Modifier.align(Alignment.Center),
                    )
                }
            }
            media.state == "failed" -> {
                PlaceholderTile(icon = Icons.Filled.BrokenImage, label = "Failed")
            }
            else -> {
                PlaceholderTile(icon = null, label = media.state.replaceFirstChar { it.uppercase() })
            }
        }

        if (media.favourited) {
            Text(
                text = "♥",
                color = Color.Red,
                modifier = Modifier
                    .align(Alignment.TopEnd)
                    .padding(4.dp),
            )
        }
    }
}

@Composable
private fun PlaceholderTile(icon: ImageVector?, label: String) {
    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(MaterialTheme.colorScheme.surfaceVariant),
        contentAlignment = Alignment.Center,
    ) {
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            if (icon != null) {
                Icon(icon, contentDescription = label)
            } else {
                CircularProgressIndicator(modifier = Modifier.padding(bottom = 4.dp))
            }
            Text(label, style = MaterialTheme.typography.labelSmall)
        }
    }
}

@Composable
private fun LoadMoreRow(isLoading: Boolean, onLoadMore: () -> Unit) {
    Box(
        modifier = Modifier
            .fillMaxWidth()
            .padding(16.dp)
            .clickable(enabled = !isLoading, onClick = onLoadMore),
    ) {
        if (isLoading) {
            CircularProgressIndicator(modifier = Modifier.align(Alignment.Center))
        } else {
            Text("Load more", modifier = Modifier.align(Alignment.Center))
        }
    }
}

private const val MAX_PICK_ITEMS = 25
