package dev.joeherbert.cameraderie.app

import android.app.Application
import androidx.work.Configuration
import dev.joeherbert.cameraderie.data.upload.CameraderieWorkerFactory

/**
 * Application entry point. Owns the (very small, hand-rolled) [AppContainer]
 * dependency graph and configures WorkManager with a custom [androidx.work.WorkerFactory]
 * so [dev.joeherbert.cameraderie.data.upload.UploadWorker] can receive the
 * shared, already-authenticated [dev.joeherbert.cameraderie.data.network.ApiService].
 */
class CameraderieApp : Application(), Configuration.Provider {

    lateinit var container: AppContainer
        private set

    override fun onCreate() {
        super.onCreate()
        container = AppContainer(this)
    }

    override val workManagerConfiguration: Configuration
        get() = Configuration.Builder()
            .setWorkerFactory(CameraderieWorkerFactory(container.apiService))
            .build()
}
