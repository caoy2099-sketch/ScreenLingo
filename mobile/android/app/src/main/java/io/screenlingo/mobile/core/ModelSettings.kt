package io.screenlingo.mobile.core

import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull

data class ModelSettings(
    val endpoint: String = "https://api.openai.com/v1",
    val apiKey: String = "",
    val model: String = "",
    val visionModel: String = "",
) {
    // Avoid exposing the key if this value ever appears in diagnostic output.
    override fun toString() = "ModelSettings(endpoint=$endpoint, apiKey=<redacted>, model=$model, visionModel=$visionModel)"
}

/** Returns a canonical base URL, or a full /chat/completions URL if supplied. */
fun validateEndpoint(endpoint: String): String {
    val raw = endpoint.trim()
    require(raw.length in 1..2048 && endpoint.none { it.isISOControl() } && '\\' !in raw &&
        (raw.startsWith("https://", ignoreCase = true) || raw.startsWith("http://", ignoreCase = true))) {
        "服务地址无效，请输入完整的 HTTPS 地址。"
    }
    val url = raw.toHttpUrlOrNull() ?: throw IllegalArgumentException("服务地址无效，请输入完整的 HTTPS 地址。")
    require(url.username.isEmpty() && url.password.isEmpty() && url.query == null && url.fragment == null) {
        "服务地址不能包含账号、密码、查询参数或片段。"
    }
    require(url.isHttps || isLoopback(url.host)) { "远程服务必须使用 HTTPS；HTTP 仅允许本机回环地址。" }
    return url.toString().trimEnd('/')
}

internal fun endpointUrl(endpoint: String): HttpUrl =
    validateEndpoint(endpoint).toHttpUrlOrNull() ?: error("服务地址无效。")

internal fun endpointOrigin(endpoint: String): String {
    val url = endpointUrl(endpoint)
    val host = if (url.host.contains(':')) "[${url.host}]" else url.host
    return "${url.scheme}://$host:${url.port}"
}

internal fun validatedSettings(settings: ModelSettings): ModelSettings {
    val endpoint = validateEndpoint(settings.endpoint)
    val key = settings.apiKey.trim()
    require(key.length <= 8192 && settings.apiKey.none { it.isISOControl() } && key.all { it.code in 33..126 }) { "API Key 格式不正确。" }
    fun modelName(value: String): String {
        val name = value.trim()
        require(name.length <= 200 && value.none { it.isISOControl() }) { "模型名称不能超过 200 个字符或包含控制字符。" }
        return name
    }
    return ModelSettings(endpoint, key, modelName(settings.model), modelName(settings.visionModel))
}

internal fun requireNewOriginKey(previousEndpoint: String, previousKey: String, settings: ModelSettings) {
    require(endpointOrigin(previousEndpoint) == endpointOrigin(settings.endpoint) ||
        previousKey.isEmpty() || settings.apiKey.isEmpty() || previousKey != settings.apiKey) {
        "服务地址已更换，请清空旧 API Key 并填写新服务的 Key。"
    }
}

// Match Android's exact-host network_security_config allowlist.
private fun isLoopback(host: String): Boolean = host in setOf("localhost", "127.0.0.1", "::1")
