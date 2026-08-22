package com.duhfreakinduh.driverguard

import android.content.Context
import com.google.gson.GsonBuilder
import java.io.File
import java.time.Instant
import kotlin.math.asin
import kotlin.math.cos
import kotlin.math.max
import kotlin.math.sin
import kotlin.math.sqrt

data class TripPoint(
    val lat: Double,
    val lon: Double,
    val speedMps: Float,
    val accuracyMeters: Float,
    val timeMs: Long
)

data class TripEvent(
    val type: String,
    val reasons: List<String>,
    val timeMs: Long,
    val location: TripPoint?
)

data class TripData(
    val version: Int = 1,
    val startedAt: String,
    var endedAt: String? = null,
    val faceModel: String = "Hugging Face abiral1011/skin_detect face_landmarker.task",
    val phoneModel: String = "Hugging Face Xenova/yolos-tiny quantized ONNX",
    val route: MutableList<TripPoint> = mutableListOf(),
    val events: MutableList<TripEvent> = mutableListOf(),
    var distanceMeters: Double = 0.0,
    var maxSpeedMps: Float = 0f
)

class TripRecorder(private val context: Context) {
    private val gson = GsonBuilder().setPrettyPrinting().create()
    var trip: TripData? = null
        private set
    var latestPoint: TripPoint? = null
        private set

    fun start() {
        trip = TripData(startedAt = Instant.now().toString())
        latestPoint = null
        addEvent("trip_start", emptyList())
    }

    fun addLocation(lat: Double, lon: Double, speedMps: Float, accuracyMeters: Float, timeMs: Long) {
        val t = trip ?: return
        val previous = t.route.lastOrNull()
        var speed = speedMps
        val candidate = TripPoint(lat, lon, max(0f, speed), accuracyMeters, timeMs)
        if (previous != null) {
            val meters = haversine(previous.lat, previous.lon, lat, lon)
            val dt = max(1.0, (timeMs - previous.timeMs) / 1000.0)
            if (speed < 0f) speed = (meters / dt).toFloat()
            val plausible = meters <= max(120.0, dt * 75.0)
            if (!plausible) return
            if (meters > 1.5) t.distanceMeters += meters
        }
        val point = candidate.copy(speedMps = speed.coerceIn(0f, 90f))
        t.route += point
        t.maxSpeedMps = max(t.maxSpeedMps, point.speedMps)
        latestPoint = point
    }

    fun addEvent(type: String, reasons: Collection<String>) {
        val t = trip ?: return
        t.events += TripEvent(type, reasons.toList(), System.currentTimeMillis(), latestPoint)
    }

    fun stopAndSave(): File? {
        val t = trip ?: return null
        addEvent("trip_end", emptyList())
        t.endedAt = Instant.now().toString()
        val dir = File(context.filesDir, "driver_guard_trips").apply { mkdirs() }
        val file = File(dir, "trip-${System.currentTimeMillis()}.json")
        file.writeText(gson.toJson(t))
        trip = null
        latestPoint = null
        return file
    }

    val distanceMiles: Double get() = (trip?.distanceMeters ?: 0.0) / 1609.344
    val eventCount: Int get() = trip?.events?.count { it.type !in setOf("trip_start", "trip_end") } ?: 0

    private fun haversine(lat1: Double, lon1: Double, lat2: Double, lon2: Double): Double {
        val earth = 6_371_000.0
        val dLat = Math.toRadians(lat2 - lat1)
        val dLon = Math.toRadians(lon2 - lon1)
        val a = sin(dLat / 2) * sin(dLat / 2) +
            cos(Math.toRadians(lat1)) * cos(Math.toRadians(lat2)) *
            sin(dLon / 2) * sin(dLon / 2)
        return 2 * earth * asin(sqrt(a))
    }
}
