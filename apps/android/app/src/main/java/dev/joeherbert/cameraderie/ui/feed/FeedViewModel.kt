package dev.joeherbert.cameraderie.ui.feed

import android.net.Uri
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import androidx.work.WorkInfo
import dev.joeherbert.cameraderie.data.auth.AuthRepository
import dev.joeherbert.cameraderie.data.media.MediaRepository
import dev.joeherbert.cameraderie.data.network.ApiException
import dev.joeherbert.cameraderie.data.network.MediaDto
import dev.joeherbert.cameraderie.data.upload.UploadRepository
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

data class FeedUiState(
    val isLoading: Boolean = false,
    val isLoadingMore: Boolean = false,
    val media: List<MediaDto> = emptyList(),
    val nextCursor: String? = null,
    val error: String? = null,
    val activeUploads: List<WorkInfo> = emptyList(),
)

class FeedViewModel(
    private val groupId: String,
    private val mediaRepository: MediaRepository,
    private val uploadRepository: UploadRepository,
    private val authRepository: AuthRepository,
) : ViewModel() {

    private val _uiState = MutableStateFlow(FeedUiState())
    val uiState: StateFlow<FeedUiState> = _uiState.asStateFlow()

    private var succeededWorkIds = mutableSetOf<String>()

    init {
        refresh()
        observeUploads()
    }

    private fun observeUploads() {
        viewModelScope.launch {
            uploadRepository.observeGroupUploads(groupId).collect { infos ->
                _uiState.value = _uiState.value.copy(
                    activeUploads = infos.filter {
                        it.state == WorkInfo.State.RUNNING || it.state == WorkInfo.State.ENQUEUED
                    }
                )
                val newlySucceeded = infos.filter {
                    it.state == WorkInfo.State.SUCCEEDED && succeededWorkIds.add(it.id.toString())
                }
                if (newlySucceeded.isNotEmpty()) {
                    refresh()
                }
            }
        }
    }

    fun refresh() {
        viewModelScope.launch {
            _uiState.value = _uiState.value.copy(isLoading = true, error = null)
            try {
                val (media, cursor) = mediaRepository.listGroupMedia(groupId)
                _uiState.value = _uiState.value.copy(isLoading = false, media = media, nextCursor = cursor)
            } catch (e: ApiException) {
                if (e.isUnauthorized) authRepository.handleUnauthorized()
                _uiState.value = _uiState.value.copy(isLoading = false, error = e.message)
            } catch (e: Exception) {
                _uiState.value = _uiState.value.copy(isLoading = false, error = "Network error: ${e.message}")
            }
        }
    }

    fun loadMore() {
        val cursor = _uiState.value.nextCursor ?: return
        if (_uiState.value.isLoadingMore) return
        viewModelScope.launch {
            _uiState.value = _uiState.value.copy(isLoadingMore = true)
            try {
                val (media, nextCursor) = mediaRepository.listGroupMedia(groupId, before = cursor)
                _uiState.value = _uiState.value.copy(
                    isLoadingMore = false,
                    media = _uiState.value.media + media,
                    nextCursor = nextCursor,
                )
            } catch (e: Exception) {
                _uiState.value = _uiState.value.copy(isLoadingMore = false, error = e.message)
            }
        }
    }

    fun uploadFiles(uris: List<Uri>) {
        uris.forEach { uri -> uploadRepository.enqueueUpload(groupId, uri) }
    }

    class Factory(
        private val groupId: String,
        private val mediaRepository: MediaRepository,
        private val uploadRepository: UploadRepository,
        private val authRepository: AuthRepository,
    ) : ViewModelProvider.Factory {
        @Suppress("UNCHECKED_CAST")
        override fun <T : ViewModel> create(modelClass: Class<T>): T =
            FeedViewModel(groupId, mediaRepository, uploadRepository, authRepository) as T
    }
}
