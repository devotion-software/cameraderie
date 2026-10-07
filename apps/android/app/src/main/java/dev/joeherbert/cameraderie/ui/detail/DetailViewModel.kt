package dev.joeherbert.cameraderie.ui.detail

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import dev.joeherbert.cameraderie.data.auth.AuthRepository
import dev.joeherbert.cameraderie.data.media.MediaRepository
import dev.joeherbert.cameraderie.data.network.ApiException
import dev.joeherbert.cameraderie.data.network.DownloadResponse
import dev.joeherbert.cameraderie.data.network.MediaDto
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

data class DetailUiState(
    val isLoading: Boolean = false,
    val media: MediaDto? = null,
    val currentUserId: String? = null,
    val error: String? = null,
    val isMutating: Boolean = false,
    val pendingDownload: DownloadResponse? = null,
    val deleted: Boolean = false,
    val reportSent: Boolean = false,
) {
    val canDelete: Boolean
        get() = media != null && currentUserId != null && media.uploaderId == currentUserId
}

class DetailViewModel(
    private val mediaId: String,
    private val mediaRepository: MediaRepository,
    private val authRepository: AuthRepository,
) : ViewModel() {

    private val _uiState = MutableStateFlow(DetailUiState())
    val uiState: StateFlow<DetailUiState> = _uiState.asStateFlow()

    init {
        load()
    }

    fun load() {
        viewModelScope.launch {
            _uiState.value = _uiState.value.copy(isLoading = true, error = null)
            try {
                val media = mediaRepository.getMedia(mediaId)
                val me = runCatching { authRepository.fetchMe() }.getOrNull()
                _uiState.value = _uiState.value.copy(isLoading = false, media = media, currentUserId = me?.id)
            } catch (e: ApiException) {
                if (e.isUnauthorized) authRepository.handleUnauthorized()
                _uiState.value = _uiState.value.copy(isLoading = false, error = e.message)
            } catch (e: Exception) {
                _uiState.value = _uiState.value.copy(isLoading = false, error = "Network error: ${e.message}")
            }
        }
    }

    fun toggleFavourite() {
        val media = _uiState.value.media ?: return
        viewModelScope.launch {
            _uiState.value = _uiState.value.copy(isMutating = true)
            try {
                if (media.favourited) {
                    mediaRepository.unfavourite(media.id)
                } else {
                    mediaRepository.favourite(media.id)
                }
                val refreshed = media.copy(
                    favourited = !media.favourited,
                    favouriteCount = media.favouriteCount + if (media.favourited) -1 else 1,
                )
                _uiState.value = _uiState.value.copy(isMutating = false, media = refreshed)
            } catch (e: Exception) {
                _uiState.value = _uiState.value.copy(isMutating = false, error = e.message)
            }
        }
    }

    fun requestDownload() {
        val media = _uiState.value.media ?: return
        viewModelScope.launch {
            _uiState.value = _uiState.value.copy(isMutating = true, error = null)
            try {
                val download = mediaRepository.getDownload(media.id)
                _uiState.value = _uiState.value.copy(isMutating = false, pendingDownload = download)
            } catch (e: Exception) {
                _uiState.value = _uiState.value.copy(isMutating = false, error = e.message)
            }
        }
    }

    fun consumeDownload() {
        _uiState.value = _uiState.value.copy(pendingDownload = null)
    }

    fun report(reason: String) {
        val media = _uiState.value.media ?: return
        viewModelScope.launch {
            _uiState.value = _uiState.value.copy(isMutating = true, error = null)
            try {
                mediaRepository.report(media.id, reason)
                _uiState.value = _uiState.value.copy(isMutating = false, reportSent = true)
            } catch (e: Exception) {
                _uiState.value = _uiState.value.copy(isMutating = false, error = e.message)
            }
        }
    }

    fun consumeReportSent() {
        _uiState.value = _uiState.value.copy(reportSent = false)
    }

    fun delete() {
        val media = _uiState.value.media ?: return
        viewModelScope.launch {
            _uiState.value = _uiState.value.copy(isMutating = true, error = null)
            try {
                mediaRepository.delete(media.id)
                _uiState.value = _uiState.value.copy(isMutating = false, deleted = true)
            } catch (e: Exception) {
                _uiState.value = _uiState.value.copy(isMutating = false, error = e.message)
            }
        }
    }

    class Factory(
        private val mediaId: String,
        private val mediaRepository: MediaRepository,
        private val authRepository: AuthRepository,
    ) : ViewModelProvider.Factory {
        @Suppress("UNCHECKED_CAST")
        override fun <T : ViewModel> create(modelClass: Class<T>): T =
            DetailViewModel(mediaId, mediaRepository, authRepository) as T
    }
}
