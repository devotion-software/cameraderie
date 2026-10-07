package dev.joeherbert.cameraderie.app

import android.content.Context
import dev.joeherbert.cameraderie.data.auth.AuthRepository
import dev.joeherbert.cameraderie.data.auth.TokenStore
import dev.joeherbert.cameraderie.data.groups.GroupsRepository
import dev.joeherbert.cameraderie.data.media.MediaRepository
import dev.joeherbert.cameraderie.data.network.ApiService
import dev.joeherbert.cameraderie.data.upload.UploadRepository

/**
 * Minimal, hand-rolled dependency container. The project intentionally avoids
 * pulling in Hilt/Dagger to keep the sample easy to read end-to-end; swap this
 * out for a DI framework if the app grows.
 */
class AppContainer(context: Context) {
    val tokenStore: TokenStore = TokenStore(context)
    val apiService: ApiService = ApiService(tokenStore)

    val authRepository: AuthRepository = AuthRepository(apiService, tokenStore)
    val groupsRepository: GroupsRepository = GroupsRepository(apiService)
    val mediaRepository: MediaRepository = MediaRepository(apiService)
    val uploadRepository: UploadRepository = UploadRepository(context, apiService)
}
