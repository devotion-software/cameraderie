package dev.joeherbert.cameraderie.ui.groups

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.ExitToApp
import androidx.compose.material.icons.filled.GroupAdd
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Card
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FloatingActionButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.lifecycle.viewmodel.compose.viewModel
import dev.joeherbert.cameraderie.data.auth.AuthRepository
import dev.joeherbert.cameraderie.data.groups.GroupsRepository
import dev.joeherbert.cameraderie.data.network.GroupDto

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun GroupsScreen(
    groupsRepository: GroupsRepository,
    authRepository: AuthRepository,
    onOpenGroup: (GroupDto) -> Unit,
    onSignedOut: () -> Unit,
) {
    val viewModel: GroupsViewModel = viewModel(
        factory = GroupsViewModel.Factory(groupsRepository, authRepository)
    )
    val state by viewModel.uiState.collectAsState()
    var showCreateDialog by remember { mutableStateOf(false) }
    var showJoinDialog by remember { mutableStateOf(false) }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Your groups") },
                actions = {
                    IconButton(onClick = { showJoinDialog = true }) {
                        Icon(Icons.Filled.GroupAdd, contentDescription = "Join group with invite code")
                    }
                    IconButton(onClick = {
                        viewModel.signOut()
                        onSignedOut()
                    }) {
                        Icon(Icons.Filled.ExitToApp, contentDescription = "Sign out")
                    }
                },
            )
        },
        floatingActionButton = {
            FloatingActionButton(onClick = { showCreateDialog = true }) {
                Icon(Icons.Filled.Add, contentDescription = "Create group")
            }
        },
    ) { padding ->
        Column(modifier = Modifier.padding(padding)) {
            state.usage?.let { usage ->
                UsageCard(usedBytes = usage.usedBytes, quotaBytes = usage.quotaBytes, readOnly = usage.readOnly)
            }

            when {
                state.isLoading && state.groups.isEmpty() -> {
                    Column(
                        modifier = Modifier.fillMaxSize(),
                        verticalArrangement = Arrangement.Center,
                    ) {
                        CircularProgressIndicator(modifier = Modifier.padding(32.dp))
                    }
                }
                state.error != null && state.groups.isEmpty() -> {
                    Text(
                        text = state.error ?: "Something went wrong",
                        color = MaterialTheme.colorScheme.error,
                        modifier = Modifier.padding(16.dp),
                    )
                }
                else -> {
                    LazyColumn(contentPadding = PaddingValues(16.dp)) {
                        items(state.groups, key = { it.id }) { group ->
                            GroupRow(group = group, onClick = { onOpenGroup(group) })
                        }
                    }
                }
            }
        }
    }

    if (showCreateDialog) {
        CreateGroupDialog(
            isSubmitting = state.isCreatingGroup,
            onDismiss = { showCreateDialog = false },
            onCreate = { name, description ->
                viewModel.createGroup(name, description) {
                    showCreateDialog = false
                }
            },
        )
    }

    if (showJoinDialog) {
        JoinGroupDialog(
            isSubmitting = state.isJoiningGroup,
            onDismiss = { showJoinDialog = false },
            onJoin = { code ->
                viewModel.joinGroup(code) { showJoinDialog = false }
            },
        )
    }
}

@Composable
private fun UsageCard(usedBytes: Long, quotaBytes: Long, readOnly: Boolean) {
    val fraction = if (quotaBytes > 0) (usedBytes.toFloat() / quotaBytes.toFloat()).coerceIn(0f, 1f) else 0f
    Card(modifier = Modifier
        .fillMaxWidth()
        .padding(16.dp)) {
        Column(modifier = Modifier.padding(16.dp)) {
            Text("Storage", style = MaterialTheme.typography.titleLarge)
            LinearProgressIndicator(
                progress = { fraction },
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(vertical = 8.dp),
            )
            Text("${formatBytes(usedBytes)} of ${formatBytes(quotaBytes)} used")
            if (readOnly) {
                Text(
                    text = "Storage full — uploads are disabled until you free up space.",
                    color = MaterialTheme.colorScheme.error,
                )
            }
        }
    }
}

@Composable
private fun GroupRow(group: GroupDto, onClick: () -> Unit) {
    Card(
        modifier = Modifier
            .fillMaxWidth()
            .padding(vertical = 6.dp),
        onClick = onClick,
    ) {
        Column(modifier = Modifier.padding(16.dp)) {
            Text(group.name, style = MaterialTheme.typography.titleLarge)
            group.description?.takeIf { it.isNotBlank() }?.let {
                Text(it, style = MaterialTheme.typography.bodyLarge)
            }
            group.myRole?.let {
                Text(
                    text = it.replaceFirstChar { c -> c.uppercase() },
                    style = MaterialTheme.typography.labelSmall,
                    modifier = Modifier.padding(top = 4.dp),
                )
            }
        }
    }
}

@Composable
private fun CreateGroupDialog(
    isSubmitting: Boolean,
    onDismiss: () -> Unit,
    onCreate: (name: String, description: String?) -> Unit,
) {
    var name by remember { mutableStateOf("") }
    var description by remember { mutableStateOf("") }

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Create group") },
        text = {
            Column {
                OutlinedTextField(
                    value = name,
                    onValueChange = { name = it },
                    label = { Text("Name") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                )
                OutlinedTextField(
                    value = description,
                    onValueChange = { description = it },
                    label = { Text("Description (optional)") },
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(top = 8.dp),
                )
            }
        },
        confirmButton = {
            TextButton(
                enabled = !isSubmitting,
                onClick = { onCreate(name, description.takeIf { it.isNotBlank() }) },
            ) {
                Text("Create")
            }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) { Text("Cancel") }
        },
    )
}

@Composable
private fun JoinGroupDialog(
    isSubmitting: Boolean,
    onDismiss: () -> Unit,
    onJoin: (code: String) -> Unit,
) {
    var code by remember { mutableStateOf("") }

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Join a group") },
        text = {
            OutlinedTextField(
                value = code,
                onValueChange = { code = it },
                label = { Text("Invite code") },
                singleLine = true,
                modifier = Modifier.fillMaxWidth(),
            )
        },
        confirmButton = {
            TextButton(enabled = !isSubmitting && code.isNotBlank(), onClick = { onJoin(code) }) {
                Text("Join")
            }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) { Text("Cancel") }
        },
    )
}

private fun formatBytes(bytes: Long): String {
    val units = arrayOf("B", "KB", "MB", "GB", "TB")
    var value = bytes.toDouble()
    var unitIndex = 0
    while (value >= 1024 && unitIndex < units.lastIndex) {
        value /= 1024
        unitIndex++
    }
    return "%.1f %s".format(value, units[unitIndex])
}
