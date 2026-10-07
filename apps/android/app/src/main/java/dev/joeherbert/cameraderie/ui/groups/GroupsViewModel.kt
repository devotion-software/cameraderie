package dev.joeherbert.cameraderie.ui.groups

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import dev.joeherbert.cameraderie.data.auth.AuthRepository
import dev.joeherbert.cameraderie.data.groups.GroupsRepository
import dev.joeherbert.cameraderie.data.network.ApiException
import dev.joeherbert.cameraderie.data.network.GroupDto
import dev.joeherbert.cameraderie.data.network.UsageResponse
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

data class GroupsUiState(
    val isLoading: Boolean = false,
    val groups: List<GroupDto> = emptyList(),
    val usage: UsageResponse? = null,
    val error: String? = null,
    val isCreatingGroup: Boolean = false,
    val isJoiningGroup: Boolean = false,
)

class GroupsViewModel(
    private val groupsRepository: GroupsRepository,
    private val authRepository: AuthRepository,
) : ViewModel() {

    private val _uiState = MutableStateFlow(GroupsUiState())
    val uiState: StateFlow<GroupsUiState> = _uiState.asStateFlow()

    init {
        refresh()
    }

    fun refresh() {
        viewModelScope.launch {
            _uiState.value = _uiState.value.copy(isLoading = true, error = null)
            try {
                val groups = groupsRepository.listGroups()
                val usage = runCatching { groupsRepository.getUsage() }.getOrNull()
                _uiState.value = _uiState.value.copy(isLoading = false, groups = groups, usage = usage)
            } catch (e: ApiException) {
                if (e.isUnauthorized) authRepository.handleUnauthorized()
                _uiState.value = _uiState.value.copy(isLoading = false, error = e.message)
            } catch (e: Exception) {
                _uiState.value = _uiState.value.copy(isLoading = false, error = "Network error: ${e.message}")
            }
        }
    }

    fun createGroup(name: String, description: String?, onCreated: (GroupDto) -> Unit) {
        if (name.isBlank()) {
            _uiState.value = _uiState.value.copy(error = "Group name is required")
            return
        }
        viewModelScope.launch {
            _uiState.value = _uiState.value.copy(isCreatingGroup = true, error = null)
            try {
                val group = groupsRepository.createGroup(name.trim(), description)
                _uiState.value = _uiState.value.copy(
                    isCreatingGroup = false,
                    groups = listOf(group) + _uiState.value.groups,
                )
                onCreated(group)
            } catch (e: ApiException) {
                _uiState.value = _uiState.value.copy(isCreatingGroup = false, error = e.message)
            } catch (e: Exception) {
                _uiState.value = _uiState.value.copy(isCreatingGroup = false, error = "Network error: ${e.message}")
            }
        }
    }

    fun joinGroup(code: String, onJoined: (groupId: String) -> Unit) {
        if (code.isBlank()) {
            _uiState.value = _uiState.value.copy(error = "Invite code is required")
            return
        }
        viewModelScope.launch {
            _uiState.value = _uiState.value.copy(isJoiningGroup = true, error = null)
            try {
                val (groupId, _) = groupsRepository.acceptInvite(code.trim())
                _uiState.value = _uiState.value.copy(isJoiningGroup = false)
                refresh()
                onJoined(groupId)
            } catch (e: ApiException) {
                _uiState.value = _uiState.value.copy(isJoiningGroup = false, error = e.message)
            } catch (e: Exception) {
                _uiState.value = _uiState.value.copy(isJoiningGroup = false, error = "Network error: ${e.message}")
            }
        }
    }

    fun signOut() = authRepository.signOut()

    class Factory(
        private val groupsRepository: GroupsRepository,
        private val authRepository: AuthRepository,
    ) : ViewModelProvider.Factory {
        @Suppress("UNCHECKED_CAST")
        override fun <T : ViewModel> create(modelClass: Class<T>): T =
            GroupsViewModel(groupsRepository, authRepository) as T
    }
}
