package jp.taxiapp.gpsprototype

import android.content.Context
import android.content.Intent
import jp.taxiapp.gps.Snapshot
import org.json.JSONObject
import java.io.BufferedReader
import java.io.InputStreamReader
import java.net.InetAddress
import java.net.ServerSocket
import java.net.Socket
import java.net.SocketException
import java.net.URLDecoder
import java.nio.charset.StandardCharsets
import java.util.concurrent.atomic.AtomicBoolean

/**
 * Serves the external mobile browser on device-only loopback.
 * Zero custom-browser tabs, zero external network, no write endpoints.
 * Hosts only 127.0.0.1 and rejects DNS-rebinding host headers.
 */
class GpsLoopbackServer(private val context: Context) {
    companion object {
        const val IDENTITY_MARKER = "GPS_DISTANCE_LAB_EXTERNAL_V1_0"
        const val PORT = 48764
        const val URL = "http://127.0.0.1:48764/"
    }
    private val active=AtomicBoolean(false)
    private var listeningSocket: ServerSocket?=null

    fun start() {
        if (!active.compareAndSet(false,true))return
        try {
            listeningSocket=ServerSocket(PORT,8,InetAddress.getByName("127.0.0.1"))
            Thread({
                while(active.get()) {
                    try {
                        val client=listeningSocket?.accept() ?: break
                        Thread({serve(client)},"gps-lab-http-request").start()
                    }catch(_:SocketException){if(!active.get())break}
                     catch(_:Exception){if(!active.get())break}
                }
            },"gps-lab-loopback").apply{isDaemon=true;start()}
        }catch(e:Exception){
            active.set(false)
            runCatching{listeningSocket?.close()}
            listeningSocket=null
            throw e
        }
    }
    fun stop() {
        active.set(false)
        runCatching{listeningSocket?.close()}
        listeningSocket=null
    }
    private fun serve(client:Socket) {
        client.use{s->
            try {
                s.soTimeout=5000
                val reader=BufferedReader(InputStreamReader(s.getInputStream(),StandardCharsets.ISO_8859_1))
                val request=reader.readLine()?:return
                if(request.length>4096||!request.startsWith("GET ")){
                    reply(s,405,"text/plain; charset=utf-8","GET only");return
                }
                val route=request.split(" ").getOrNull(1)?:return
                var host=""
                var lines=0
                while(true) {
                    val line=reader.readLine()?:return
                    if(line.isEmpty())break
                    if(line.length>4096||++lines>50)return
                    if(line.startsWith("Host:",true))host=line.substringAfter(":").trim()
                }
                if(host!="127.0.0.1:48764"){
                    reply(s,403,"text/plain; charset=utf-8","Invalid Host");return
                }
                when {
                    route=="/"||route=="/index.html"->{
                        val ui=context.assets.open("distance-console.html").bufferedReader(Charsets.UTF_8).use{it.readText()}
                        val bridge=context.assets.open("gps-external-bridge.js").bufferedReader(Charsets.UTF_8).use{it.readText()}
                        reply(s,200,"text/html; charset=utf-8",
                            ui.replace("<script>","<script>"+bridge+"</script>\n<script>"))
                    }
                    route=="/api/identity"->reply(s,200,"application/json; charset=utf-8",
                        JSONObject().put("marker",IDENTITY_MARKER)
                            .put("packageId",context.packageName)
                            .put("webVersion","1.0.0")
                            .toString())
                    route=="/api/status"->reply(s,200,"application/json; charset=utf-8",status())
                    route.startsWith("/api/capture?")->{
                        val params=params(route.substringAfter("?"))
                        val nonce=params["nonce"].orEmpty()
                        val target=params["target"].orEmpty()
                        if(!Regex("^[0-9a-f]{32}$").matches(nonce)||
                           !(target=="start"||(Regex("^(0|[1-9][0-9]?)$").matches(target)&&target.toInt()<60))){
                            reply(s,400,"application/json; charset=utf-8",
                                JSONObject().put("ready",false).put("message","取得番号が不正です").toString())
                        }else reply(s,200,"application/json; charset=utf-8",capture(nonce,target))
                    }
                    route=="/favicon.ico"->reply(s,204,"text/plain","")
                    else->reply(s,404,"text/plain","Not Found")
                }
            }catch(_:Exception){/* Chrome disconnected; keep GPS service running. */}
        }
    }
    private fun params(q:String):Map<String,String>{
        if(q.length>512)return emptyMap()
        return q.split("&").mapNotNull{
            val pair=it.split("=",limit=2)
            if(pair.size!=2)null else try{
                URLDecoder.decode(pair[0],"UTF-8") to URLDecoder.decode(pair[1],"UTF-8")
            }catch(_:Exception){null}
        }.toMap()
    }
    private fun status():String{
        val s=GpsStore.load(context)
        val last=GpsStore.lastValidGpsFixAt(context)
        val age=if(last<=0L)null else(System.currentTimeMillis()-last).coerceAtLeast(0L)
        return JSONObject()
            .put("running",s.running)
            .put("ageMs",age?:JSONObject.NULL)
            .put("accuracyMeters",s.lastAccuracyMeters?:JSONObject.NULL)
            .put("gaps",s.gapCount)
            .put("unresolvedGap",s.unresolvedGap).toString()
    }
    private fun capture(nonce:String,target:String):String{
        val s:Snapshot=GpsStore.load(context)
        val last=GpsStore.lastValidGpsFixAt(context)
        val now=System.currentTimeMillis()
        val age=if(last<=0L)Long.MAX_VALUE else(now-last).coerceAtLeast(0L)
        val accuracy=s.lastAccuracyMeters
        val ready=s.running&&last>0L&&age<=15000L&&
            accuracy!=null&&accuracy.isFinite()&&accuracy in 0.01..45.0
        val res=JSONObject().put("ready",ready)
        if(!ready) {
            if (s.running) {
                // GET from Chrome never navigates. It asks the existing foreground
                // service for a GPS_PROVIDER one-shot fix, rate-limited by service.
                runCatching {
                    context.startService(Intent(context,GpsTrackingService::class.java)
                        .setAction(GpsTrackingService.ACTION_REFRESH))
                }
            }
            val seconds=if(last<=0L) "未受信" else ((age/1000L).toString()+"秒前")
            return res.put("gpsAgeMs",if(last<=0L)JSONObject.NULL else age)
                .put("message",if(!s.running)
                    "GPS測定が停止しています。GPS計測アプリで開始してください。"
                else "GPS再測位中（有効GPS "+seconds+"）。位置情報を待っています。")
                .toString()
        }
        return res.put("snapshot",JSONObject()
            .put("format","GPS_DISTANCE_LAB_V1")
            .put("nonce",nonce)
            .put("target",target)
            .put("tripKm",s.tripKm)
            .put("capturedAt",now)
            .put("gpsAgeMs",age)
            .put("running",true)
            .put("unresolvedGap",s.unresolvedGap)).toString()
    }
    private fun reply(s:Socket,code:Int,type:String,body:String){
        val data=body.toByteArray(StandardCharsets.UTF_8)
        val title=when(code){200->"OK";204->"No Content";400->"Bad Request";403->"Forbidden";404->"Not Found";else->"Method Not Allowed"}
        val headers="HTTP/1.1 $code $title\r\n"+
            "Content-Type: $type\r\n"+
            "Content-Length: "+data.size+"\r\n"+
            "Cache-Control: no-store\r\n"+
            "X-Content-Type-Options: nosniff\r\n"+
            "Referrer-Policy: no-referrer\r\n"+
            "X-Frame-Options: DENY\r\n"+
            "Connection: close\r\n\r\n"
        val out=s.getOutputStream()
        out.write(headers.toByteArray(StandardCharsets.US_ASCII))
        out.write(data)
        out.flush()
    }
}
