package dev.joeherbert.cameraderie.ui.nav

/** Centralized nav-graph route definitions. */
object Routes {
    const val AUTH = "auth"
    const val GROUPS = "groups"
    const val FEED = "feed/{groupId}/{groupName}"
    const val DETAIL = "detail/{groupId}/{mediaId}"

    fun feed(groupId: String, groupName: String) = "feed/${encode(groupId)}/${encode(groupName)}"
    fun detail(groupId: String, mediaId: String) = "detail/${encode(groupId)}/${encode(mediaId)}"

    private fun encode(value: String): String =
        java.net.URLEncoder.encode(value, "UTF-8")
}
