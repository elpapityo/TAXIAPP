package jp.taxiapp.gpsprototype

import android.content.Context
import org.json.JSONObject
import java.io.BufferedReader
import java.io.InputStreamReader
import java.net.InetAddress
import java.net.ServerSocket
import java.net.Socket
import java.security.SecureRandom
import java.util.concurrent.atomic.AtomicBoolean

/** GPS read-only loopback experiment. Binds ONLY 127.0.0.1; never modifies GpsStore. */
class GpsLoopbackServer(private val context: Context) {
    companion object {
        const val PORT = 18765
        private const val ORIGIN = "https://elpapityo.github.io"
        fun secret(context: Context): String {
            val prefs = context.getSharedPreferences("gps_loopback_test", Context.MODE_PRIVATE)
            val old = prefs.getString("secret", null)
            if (old != null && old.matches(Regex("[a-f0-9]{32}"))) return old
            val bytes = ByteArray(16).also { SecureRandom().nextBytes(it) }
            val value = bytes.joinToString("") { "%02x".format(it.toInt() and 255) }
            prefs.edit().putString("secret", value).apply()
            return value
        }
    }
    private val active = AtomicBoolean(false)
    private var socket: ServerSocket? = null
    private var worker: Thread? = null

    fun start() {
        if (!active.compareAndSet(false, true)) return
        worker = Thread {
            try {
                ServerSocket(PORT, 8, InetAddress.getByName("127.0.0.1")).use { server ->
                    socket = server
                    while (active.get()) {
                        val client = try { server.accept() } catch (_: Exception) { break }
                        client.use { respond(it) }
                    }
                }
            } catch (_: Exception) {
                active.set(false)
            } finally { socket = null }
        }.apply { name = "taxiapp-gps-loopback"; isDaemon = true; start() }
    }
    fun stop() {
        active.set(false)
        runCatching { socket?.close() }
        socket = null
    }
    private fun respond(client: Socket) {
        try {
            client.soTimeout = 2500
            val input = BufferedReader(InputStreamReader(client.getInputStream(), Charsets.US_ASCII))
            val first = input.readLine() ?: return
            if (first.length > 2048) return
            val method = first.substringBefore(' ')
            val path = first.substringAfter(' ', "").substringBefore(' ')
            var origin: String? = null
            var key: String? = null
            var host: String? = null
            var n = 0
            while (n++ < 40) {
                val line = input.readLine() ?: break
                if (line.isEmpty()) break
                if (line.length > 4096) return
                when (line.substringBefore(':').lowercase()) {
                    "origin" -> origin = line.substringAfter(':').trim()
                    "x-gps-test-key" -> key = line.substringAfter(':').trim()
                    "host" -> host = line.substringAfter(':').trim()
                }
            }
            val permitted = origin == ORIGIN && host in listOf("127.0.0.1:$PORT", "localhost:$PORT")
            val code: Int
            val payload: String
            when {
                !permitted -> { code = 403; payload = """{"error":"origin"}""" }
                method == "OPTIONS" && path == "/gps" -> { code = 204; payload = "" }
                method == "GET" && path == "/gps" && key == secret(context) -> {
                    val s = GpsStore.load(context)
                    val ageAt = GpsStore.lastGpsCallbackAt(context)
                    payload = JSONObject()
                        .put("format", "TAXIAPP_GPS_LOOPBACK_V1")
                        .put("tripKm", s.tripKm)
                        .put("running", s.running)
                        .put("gapCount", s.gapCount)
                        .put("unresolvedGap", s.unresolvedGap)
                        .put("gpsAgeMs", if(ageAt>0) (System.currentTimeMillis()-ageAt).coerceAtLeast(0) else JSONObject.NULL)
                        .put("capturedAt", System.currentTimeMillis())
                        .toString()
                    code = 200
                }
                else -> { code = 401; payload = """{"error":"unauthorized"}""" }
            }
            val response = buildString {
                append("HTTP/1.1 $code TEST\r\n")
                append("Content-Type: application/json; charset=utf-8\r\n")
                append("Cache-Control: no-store\r\n")
                append("Access-Control-Allow-Origin: $ORIGIN\r\n")
                append("Vary: Origin\r\n")
                append("Access-Control-Allow-Methods: GET, OPTIONS\r\n")
                append("Access-Control-Allow-Headers: X-GPS-Test-Key\r\n")
                append("Content-Length: ${payload.toByteArray(Charsets.UTF_8).size}\r\n")
                append("Connection: close\r\n\r\n")
                append(payload)
            }
            client.getOutputStream().write(response.toByteArray(Charsets.UTF_8))
        } catch (_: Exception) {
            // Probe failure does not interrupt GPS distance tracking.
        }
    }
}
