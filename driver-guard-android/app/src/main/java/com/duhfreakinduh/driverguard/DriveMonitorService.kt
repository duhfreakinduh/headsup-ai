package com.duhfreakinduh.driverguard

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Intent
import android.content.pm.PackageManager
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.os.Bundle
import android.os.IBinder
import android.os.PowerManager
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat

class DriveMonitorService : Service(), LocationListener {
    private lateinit var locationManager: LocationManager
    private var wakeLock: PowerManager.WakeLock? = null

    override fun onCreate() {
        super.onCreate()
        locationManager = getSystemService(LOCATION_SERVICE) as LocationManager
        val power = getSystemService(POWER_SERVICE) as PowerManager
        wakeLock = power.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "DriverGuard:DriveMonitor").apply {
            setReferenceCounted(false)
            acquire(4 * 60 * 60 * 1000L)
        }
        createChannel()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == ACTION_STOP) {
            stopSelf()
            return START_NOT_STICKY
        }

        val notification = NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_shield)
            .setContentTitle("Driver Guard AI active")
            .setContentText("Native GPS trip monitoring is running")
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .build()
        startForeground(NOTIFICATION_ID, notification)
        requestLocations()
        return START_STICKY
    }

    private fun requestLocations() {
        val fine = ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED
        val coarse = ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED
        if (!fine && !coarse) return
        try {
            if (fine && locationManager.isProviderEnabled(LocationManager.GPS_PROVIDER)) {
                locationManager.requestLocationUpdates(LocationManager.GPS_PROVIDER, 900L, 1.5f, this)
            }
            if (locationManager.isProviderEnabled(LocationManager.NETWORK_PROVIDER)) {
                locationManager.requestLocationUpdates(LocationManager.NETWORK_PROVIDER, 1500L, 4f, this)
            }
        } catch (_: SecurityException) {
        }
    }

    override fun onLocationChanged(location: Location) {
        sendBroadcast(
            Intent(ACTION_LOCATION)
                .setPackage(packageName)
                .putExtra(EXTRA_LAT, location.latitude)
                .putExtra(EXTRA_LON, location.longitude)
                .putExtra(EXTRA_SPEED, if (location.hasSpeed()) location.speed else -1f)
                .putExtra(EXTRA_ACCURACY, if (location.hasAccuracy()) location.accuracy else -1f)
                .putExtra(EXTRA_TIME, location.time)
        )
    }

    @Deprecated("Deprecated in Android API")
    override fun onStatusChanged(provider: String?, status: Int, extras: Bundle?) = Unit
    override fun onProviderEnabled(provider: String) = Unit
    override fun onProviderDisabled(provider: String) = Unit

    override fun onDestroy() {
        try {
            locationManager.removeUpdates(this)
        } catch (_: Exception) {
        }
        wakeLock?.let { if (it.isHeld) it.release() }
        wakeLock = null
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    private fun createChannel() {
        val manager = getSystemService(NotificationManager::class.java)
        manager.createNotificationChannel(
            NotificationChannel(CHANNEL_ID, "Driver monitoring", NotificationManager.IMPORTANCE_LOW)
        )
    }

    companion object {
        const val ACTION_LOCATION = "com.duhfreakinduh.driverguard.LOCATION"
        const val ACTION_STOP = "com.duhfreakinduh.driverguard.STOP_MONITOR"
        const val EXTRA_LAT = "lat"
        const val EXTRA_LON = "lon"
        const val EXTRA_SPEED = "speed"
        const val EXTRA_ACCURACY = "accuracy"
        const val EXTRA_TIME = "time"
        private const val CHANNEL_ID = "driver_guard_monitor"
        private const val NOTIFICATION_ID = 1537
    }
}
