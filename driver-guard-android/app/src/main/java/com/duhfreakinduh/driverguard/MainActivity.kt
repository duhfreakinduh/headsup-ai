package com.duhfreakinduh.driverguard

import android.Manifest
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.graphics.Color
import android.graphics.Matrix
import android.os.Build
import android.os.Bundle
import android.os.SystemClock
import android.util.Size
import android.view.View
import android.view.WindowManager
import android.widget.Toast
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.camera.core.CameraSelector
import androidx.camera.core.ConcurrentCamera
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.ImageProxy
import androidx.camera.core.Preview
import androidx.camera.core.UseCaseGroup
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.core.content.ContextCompat
import com.duhfreakinduh.driverguard.databinding.ActivityMainBinding
import org.osmdroid.config.Configuration
import org.osmdroid.tileprovider.tilesource.TileSourceFactory
import org.osmdroid.util.GeoPoint
import org.osmdroid.views.overlay.Marker
import org.osmdroid.views.overlay.Polyline
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.math.roundToInt

class MainActivity : AppCompatActivity() {
    private lateinit var binding: ActivityMainBinding
    private lateinit var alarmController: AlarmController
    private lateinit var tripRecorder: TripRecorder
    private val cameraExecutor: ExecutorService = Executors.newSingleThreadExecutor()
    private val phoneExecutor: ExecutorService = Executors.newSingleThreadExecutor()
    private val roadCameraExecutor: ExecutorService = Executors.newSingleThreadExecutor()
    private val roadInferenceExecutor: ExecutorService = Executors.newSingleThreadExecutor()
    private val phoneBusy = AtomicBoolean(false)
    private val roadBusy = AtomicBoolean(false)
    private val smithCoach = SmithCoach()

    private var cameraProvider: ProcessCameraProvider? = null
    private var faceEngine: FaceAttentionEngine? = null
    private var phoneDetector: PhoneDetector? = null
    private var roadDetector: RoadDetector? = null
    private var running = false
    private var pendingStart = false
    private var teenPreDriveApproved = false
    private var roadGuardActive = false
    private var lastAnalysisMs = 0L
    private var lastPhoneScanMs = 0L
    private var phoneVisibleUntilMs = 0L
    private var lastPhoneEventMs = 0L
    private var lastRoadScanMs = 0L
    private var lastRoadAlertMs = 0L

    private var episodeStartedMs: Long? = null
    private var warningSent = false
    private var alarmSent = false
    private var recoveryStartedMs: Long? = null
    private var lastTriggers: Set<DriverTrigger> = emptySet()

    private lateinit var routeLine: Polyline
    private var currentMarker: Marker? = null
    private val eventMarkers = mutableListOf<Marker>()

    private val permissionLauncher = registerForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions()
    ) { grants ->
        val cameraGranted = grants[Manifest.permission.CAMERA] == true ||
            ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED
        if (pendingStart && cameraGranted) startDriveInternal()
        pendingStart = false
    }

    private val locationReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) {
            if (intent?.action != DriveMonitorService.ACTION_LOCATION || !running) return
            val lat = intent.getDoubleExtra(DriveMonitorService.EXTRA_LAT, Double.NaN)
            val lon = intent.getDoubleExtra(DriveMonitorService.EXTRA_LON, Double.NaN)
            if (!lat.isFinite() || !lon.isFinite()) return
            val speed = intent.getFloatExtra(DriveMonitorService.EXTRA_SPEED, -1f)
            val accuracy = intent.getFloatExtra(DriveMonitorService.EXTRA_ACCURACY, -1f)
            val time = intent.getLongExtra(DriveMonitorService.EXTRA_TIME, System.currentTimeMillis())
            tripRecorder.addLocation(lat, lon, speed, accuracy, time)
            updateTripMap()
            updateTripStats()
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityMainBinding.inflate(layoutInflater)
        setContentView(binding.root)

        alarmController = AlarmController(this)
        tripRecorder = TripRecorder(this)
        setupMap()
        refreshOptionalFeatureUi()

        ContextCompat.registerReceiver(
            this,
            locationReceiver,
            IntentFilter(DriveMonitorService.ACTION_LOCATION),
            ContextCompat.RECEIVER_NOT_EXPORTED
        )

        binding.startButton.setOnClickListener { requestStart() }
        binding.stopButton.setOnClickListener { stopDrive() }
        binding.testButton.setOnClickListener {
            alarmController.testAlarm()
            binding.statusText.text = "TEST ALARM"
            binding.reasonText.text = "Native alarm + vibration + voice"
            binding.statusText.postDelayed({
                if (!running) {
                    binding.statusText.text = "READY"
                    binding.reasonText.text = "Monitoring off"
                }
            }, 2100)
        }
        binding.phoneCheck.setOnCheckedChangeListener { _, enabled ->
            if (enabled && running) loadPhoneDetectorAsync()
            if (!enabled) {
                phoneVisibleUntilMs = 0L
                binding.phoneStatus.text = "HF PHONE AI: disabled"
            }
        }
    }

    private fun refreshOptionalFeatureUi() {
        val smithEnabled = FeatureSettings.enabled(this, FeatureSettings.KEY_SMITH_COACH, false)
        val roadEnabled = FeatureSettings.enabled(this, FeatureSettings.KEY_REAR_ROAD_GUARD, false)
        binding.smithStatus.visibility = if (smithEnabled) View.VISIBLE else View.GONE
        if (smithEnabled && !running) binding.smithStatus.text = "SMITH COACH: ready · brief scans are encouraged"
        binding.roadGuardPanel.visibility = if (roadEnabled) View.VISIBLE else View.GONE
        if (roadEnabled && !running) binding.roadStatusText.text = "Road Guard ready · starts with drive"
    }

    private fun setupMap() {
        Configuration.getInstance().userAgentValue = packageName
        binding.mapView.setTileSource(TileSourceFactory.MAPNIK)
        binding.mapView.setMultiTouchControls(true)
        binding.mapView.controller.setZoom(4.0)
        binding.mapView.controller.setCenter(GeoPoint(39.5, -98.35))
        routeLine = Polyline().apply {
            outlinePaint.color = Color.rgb(92, 184, 255)
            outlinePaint.strokeWidth = 8f
        }
        binding.mapView.overlays.add(routeLine)
    }

    private fun requestStart() {
        if (running) return
        if (TeenModeManager.isEnabled(this) && !teenPreDriveApproved) {
            showTeenPreDriveCheck()
            return
        }

        val permissions = mutableListOf(
            Manifest.permission.CAMERA,
            Manifest.permission.ACCESS_FINE_LOCATION,
            Manifest.permission.ACCESS_COARSE_LOCATION
        )
        if (Build.VERSION.SDK_INT >= 33) permissions += Manifest.permission.POST_NOTIFICATIONS
        if (TeenModeManager.isEnabled(this)) permissions += Manifest.permission.SEND_SMS

        val missing = permissions.filter {
            ContextCompat.checkSelfPermission(this, it) != PackageManager.PERMISSION_GRANTED
        }
        if (missing.isNotEmpty()) {
            pendingStart = true
            permissionLauncher.launch(missing.toTypedArray())
        } else {
            startDriveInternal()
        }
    }

    private fun showTeenPreDriveCheck() {
        AlertDialog.Builder(this)
            .setTitle("Teen Driver Check")
            .setMessage(
                "Teen Mode is ON. Keep Driver Guard running, keep the phone mounted, and do not change settings while driving. " +
                    "Major safety events or too many warnings can automatically text the saved parent number."
            )
            .setNegativeButton("Cancel", null)
            .setPositiveButton("I'M READY") { _, _ ->
                teenPreDriveApproved = true
                requestStart()
            }
            .show()
    }

    private fun startDriveInternal() {
        if (running) return
        binding.startButton.isEnabled = false
        binding.cameraMessage.visibility = View.VISIBLE
        binding.cameraMessage.text = "Loading Hugging Face face AI…"
        binding.faceText.text = "LOADING"
        tripRecorder.start()
        if (TeenModeManager.isEnabled(this)) TeenModeManager.beginDrive()
        smithCoach.reset(SystemClock.uptimeMillis())
        lastRoadScanMs = 0L
        lastRoadAlertMs = 0L
        clearTripMap()
        clearAlertEpisode()
        binding.roadOverlay.clear()
        refreshOptionalFeatureUi()
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)

        if (TeenModeManager.isEnabled(this)) {
            if (ContextCompat.checkSelfPermission(this, Manifest.permission.SEND_SMS) == PackageManager.PERMISSION_GRANTED) {
                appendEventLog("TEEN MODE: active · parent SMS alerts armed")
            } else {
                appendEventLog("TEEN MODE: active · SMS permission missing")
            }
        }

        val locationGranted = ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED ||
            ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED
        if (locationGranted) {
            ContextCompat.startForegroundService(this, Intent(this, DriveMonitorService::class.java))
        } else {
            appendEventLog("GPS permission not granted — route tracking unavailable")
        }

        if (FeatureSettings.enabled(this, FeatureSettings.KEY_REAR_ROAD_GUARD, false)) {
            loadRoadDetectorAsync()
        }

        cameraExecutor.execute {
            try {
                if (faceEngine == null) faceEngine = FaceAttentionEngine(this)
                else faceEngine?.reset()
                runOnUiThread {
                    running = true
                    binding.stopButton.isEnabled = true
                    binding.faceText.text = "SEARCHING"
                    binding.faceDetail.text = "HF model loaded on-device"
                    binding.statusText.text = if (TeenModeManager.isEnabled(this)) "TEEN PROTECTION" else "PROTECTION"
                    binding.reasonText.text = "Finding face and fast-calibrating"
                    bindCamera()
                    if (binding.phoneCheck.isChecked) loadPhoneDetectorAsync()
                }
            } catch (e: Exception) {
                runOnUiThread { startFailed(e) }
            }
        }
    }

    @Suppress("DEPRECATION")
    private fun bindCamera() {
        val future = ProcessCameraProvider.getInstance(this)
        future.addListener({
            try {
                val provider = future.get()
                cameraProvider = provider
                val wantsRoadGuard = FeatureSettings.enabled(this, FeatureSettings.KEY_REAR_ROAD_GUARD, false)
                if (wantsRoadGuard && bindConcurrentFrontRear(provider)) {
                    binding.cameraMessage.text = "Center your face and look forward"
                    binding.roadStatusText.text = if (roadDetector == null) "Rear camera active · loading YOLOS…" else "Rear camera active · scanning road"
                } else {
                    bindFrontOnly(provider)
                    if (wantsRoadGuard) {
                        binding.roadGuardPanel.visibility = View.VISIBLE
                        binding.roadStatusText.text = "Road Guard unavailable: this phone/camera combination cannot stream front + rear together"
                    }
                }
            } catch (e: Exception) {
                startFailed(e)
            }
        }, ContextCompat.getMainExecutor(this))
    }

    private fun bindConcurrentFrontRear(provider: ProcessCameraProvider): Boolean {
        var frontSelector: CameraSelector? = null
        var rearSelector: CameraSelector? = null
        for (combination in provider.availableConcurrentCameraInfos) {
            val frontInfo = combination.firstOrNull { it.lensFacing == CameraSelector.LENS_FACING_FRONT }
            val rearInfo = combination.firstOrNull { it.lensFacing == CameraSelector.LENS_FACING_BACK }
            if (frontInfo != null && rearInfo != null) {
                frontSelector = frontInfo.cameraSelector
                rearSelector = rearInfo.cameraSelector
                break
            }
        }
        if (frontSelector == null || rearSelector == null) return false

        val frontPreview = Preview.Builder().build().also {
            it.setSurfaceProvider(binding.previewView.surfaceProvider)
        }
        val frontAnalysis = ImageAnalysis.Builder()
            .setTargetResolution(Size(640, 480))
            .setOutputImageFormat(ImageAnalysis.OUTPUT_IMAGE_FORMAT_RGBA_8888)
            .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
            .build().also { it.setAnalyzer(cameraExecutor, ::analyzeFrame) }
        val frontGroup = UseCaseGroup.Builder()
            .addUseCase(frontPreview)
            .addUseCase(frontAnalysis)
            .build()

        val rearPreview = Preview.Builder().build().also {
            it.setSurfaceProvider(binding.roadPreviewView.surfaceProvider)
        }
        val rearAnalysis = ImageAnalysis.Builder()
            .setTargetResolution(Size(640, 480))
            .setOutputImageFormat(ImageAnalysis.OUTPUT_IMAGE_FORMAT_RGBA_8888)
            .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
            .build().also { it.setAnalyzer(roadCameraExecutor, ::analyzeRoadFrame) }
        val rearGroup = UseCaseGroup.Builder()
            .addUseCase(rearPreview)
            .addUseCase(rearAnalysis)
            .build()

        return try {
            provider.unbindAll()
            provider.bindToLifecycle(
                listOf(
                    ConcurrentCamera.SingleCameraConfig(frontSelector, frontGroup, this),
                    ConcurrentCamera.SingleCameraConfig(rearSelector, rearGroup, this)
                )
            )
            roadGuardActive = true
            binding.roadGuardPanel.visibility = View.VISIBLE
            true
        } catch (_: Exception) {
            roadGuardActive = false
            false
        }
    }

    private fun bindFrontOnly(provider: ProcessCameraProvider) {
        roadGuardActive = false
        val preview = Preview.Builder().build().also {
            it.setSurfaceProvider(binding.previewView.surfaceProvider)
        }
        val analysis = ImageAnalysis.Builder()
            .setTargetResolution(Size(640, 480))
            .setOutputImageFormat(ImageAnalysis.OUTPUT_IMAGE_FORMAT_RGBA_8888)
            .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
            .build()
        analysis.setAnalyzer(cameraExecutor, ::analyzeFrame)
        provider.unbindAll()
        provider.bindToLifecycle(
            this,
            CameraSelector.DEFAULT_FRONT_CAMERA,
            preview,
            analysis
        )
        binding.cameraMessage.text = "Center your face and look forward"
    }

    private fun analyzeFrame(image: ImageProxy) {
        if (!running) {
            image.close()
            return
        }
        val now = SystemClock.uptimeMillis()
        if (now - lastAnalysisMs < 65L) {
            image.close()
            return
        }
        lastAnalysisMs = now

        val bitmap = try {
            imageToBitmap(image, mirror = true)
        } catch (e: Exception) {
            image.close()
            runOnUiThread {
                binding.faceText.text = "CAMERA ERROR"
                binding.faceDetail.text = e.message ?: "Frame conversion failed"
            }
            return
        }

        val result = try {
            faceEngine?.analyze(bitmap, now)
        } catch (e: Exception) {
            runOnUiThread {
                binding.faceText.text = "AI ERROR"
                binding.faceDetail.text = e.message ?: "Face inference failed"
            }
            null
        }

        if (result != null) {
            val combined = result.triggers.toMutableSet()
            if (System.currentTimeMillis() < phoneVisibleUntilMs) combined += DriverTrigger.PHONE_VISIBLE
            runOnUiThread { applyFaceResult(result, combined) }

            if (binding.phoneCheck.isChecked && result.calibrated && combined.isEmpty() &&
                System.currentTimeMillis() - lastPhoneScanMs >= 4500L && phoneDetector != null && phoneBusy.compareAndSet(false, true)) {
                lastPhoneScanMs = System.currentTimeMillis()
                val phoneFrame = Bitmap.createScaledBitmap(bitmap, 320, (320f * bitmap.height / bitmap.width).roundToInt().coerceAtLeast(180), true)
                phoneExecutor.execute {
                    try {
                        val score = phoneDetector?.detectPhone(phoneFrame) ?: 0f
                        if (score >= 0.32f) {
                            phoneVisibleUntilMs = System.currentTimeMillis() + 3500L
                            runOnUiThread {
                                binding.phoneStatus.text = "HF PHONE AI: PHONE ${(score * 100).toInt()}%"
                                if (System.currentTimeMillis() - lastPhoneEventMs > 3500L) {
                                    lastPhoneEventMs = System.currentTimeMillis()
                                    recordEvent("phone_detected", setOf(DriverTrigger.PHONE_VISIBLE))
                                }
                            }
                        } else {
                            runOnUiThread { binding.phoneStatus.text = "HF PHONE AI: clear · ${(score * 100).toInt()}%" }
                        }
                    } catch (e: Exception) {
                        runOnUiThread { binding.phoneStatus.text = "HF PHONE AI: ${e.message ?: "scan failed"}" }
                    } finally {
                        phoneFrame.recycle()
                        phoneBusy.set(false)
                    }
                }
            }
        }
        bitmap.recycle()
    }

    private fun analyzeRoadFrame(image: ImageProxy) {
        if (!running || !roadGuardActive || !FeatureSettings.enabled(this, FeatureSettings.KEY_REAR_ROAD_GUARD, false)) {
            image.close()
            return
        }
        val now = SystemClock.uptimeMillis()
        if (now - lastRoadScanMs < 1100L || roadDetector == null || !roadBusy.compareAndSet(false, true)) {
            image.close()
            return
        }
        lastRoadScanMs = now

        val bitmap = try {
            imageToBitmap(image, mirror = false)
        } catch (e: Exception) {
            image.close()
            roadBusy.set(false)
            runOnUiThread { binding.roadStatusText.text = "Road camera error: ${e.message ?: "frame failed"}" }
            return
        }

        roadInferenceExecutor.execute {
            try {
                val detections = roadDetector?.detect(bitmap).orEmpty()
                runOnUiThread { applyRoadDetections(detections) }
            } catch (e: Exception) {
                runOnUiThread { binding.roadStatusText.text = "Road AI error: ${e.message ?: "scan failed"}" }
            } finally {
                bitmap.recycle()
                roadBusy.set(false)
            }
        }
    }

    private fun imageToBitmap(image: ImageProxy, mirror: Boolean): Bitmap {
        val rotation = image.imageInfo.rotationDegrees
        val source = Bitmap.createBitmap(image.width, image.height, Bitmap.Config.ARGB_8888)
        val buffer = image.planes[0].buffer
        buffer.rewind()
        source.copyPixelsFromBuffer(buffer)
        image.close()
        val matrix = Matrix().apply {
            postRotate(rotation.toFloat())
            if (mirror) postScale(-1f, 1f)
        }
        val rotated = Bitmap.createBitmap(source, 0, 0, source.width, source.height, matrix, true)
        if (rotated !== source) source.recycle()
        return rotated
    }

    private fun applyFaceResult(result: FaceAnalysis, triggers: Set<DriverTrigger>) {
        val rawDanger = result.rawEyesClosed || result.rawAway
        val label = when {
            !result.hasFace -> "NO FACE"
            DriverTrigger.EYES_CLOSED in triggers -> "EYES CLOSED"
            triggers.isNotEmpty() -> "DISTRACTED"
            result.rawEyesClosed -> "EYES CLOSING"
            result.rawAway -> "LOOKING AWAY"
            !result.calibrated -> "CALIBRATE"
            else -> "OK"
        }
        binding.faceText.text = label
        binding.faceDetail.text = "${result.detail} · ${result.inferenceMs} ms"
        binding.faceOverlay.setFace(result.normalizedPoints, triggers.isNotEmpty())
        binding.cameraMessage.visibility = if (result.calibrated) View.GONE else View.VISIBLE
        if (!result.calibrated && result.hasFace) binding.cameraMessage.text = if (result.rawEyesClosed) "Open both eyes to calibrate" else "Look forward — calibrating"
        if (!result.hasFace) binding.cameraMessage.text = "Face not visible — protection active"

        if (FeatureSettings.enabled(this, FeatureSettings.KEY_SMITH_COACH, false)) {
            binding.smithStatus.visibility = View.VISIBLE
            val coach = smithCoach.update(
                rawAway = result.rawAway,
                hasAttentionTrigger = triggers.isNotEmpty(),
                nowMs = SystemClock.uptimeMillis()
            )
            binding.smithStatus.text = "SMITH COACH: ${coach.message} · scans ${coach.scanCount}"
        } else {
            binding.smithStatus.visibility = View.GONE
        }

        updateAlertEpisode(triggers, rawDanger)
    }

    private fun applyRoadDetections(detections: List<RoadDetection>) {
        binding.roadOverlay.setDetections(detections)
        val top = detections.firstOrNull()
        if (top == null) {
            binding.roadStatusText.text = "ROAD CLEAR · selected YOLOS road objects not in lane corridor"
            return
        }

        val extra = if (detections.size > 1) " +${detections.size - 1}" else ""
        binding.roadStatusText.text = when (top.risk) {
            RoadRisk.HAZARD -> "HAZARD: ${top.label} ahead ${(top.confidence * 100).toInt()}%$extra"
            RoadRisk.WATCH -> "WATCH: ${top.label} in forward lane ${(top.confidence * 100).toInt()}%$extra"
            RoadRisk.NONE -> "ROAD CLEAR"
        }

        if (top.risk == RoadRisk.HAZARD && FeatureSettings.enabled(this, FeatureSettings.KEY_ROAD_HAZARDS, false)) {
            val now = SystemClock.uptimeMillis()
            if (now - lastRoadAlertMs >= 5000L) {
                lastRoadAlertMs = now
                alarmController.roadWarning(top.label)
                recordRoadEvent(top)
            }
        }
    }

    private fun updateAlertEpisode(triggers: Set<DriverTrigger>, rawDanger: Boolean) {
        val now = SystemClock.uptimeMillis()
        if (triggers.isEmpty()) {
            if (episodeStartedMs != null) {
                if (recoveryStartedMs == null) recoveryStartedMs = now
                if (now - (recoveryStartedMs ?: now) >= 300L) {
                    recordEvent("recovered", lastTriggers)
                    clearAlertEpisode()
                    binding.statusText.text = if (running) "ATTENTIVE" else "READY"
                    binding.statusText.setTextColor(Color.rgb(53, 224, 138))
                    binding.reasonText.text = "No active trigger"
                }
            } else if (rawDanger) {
                binding.statusText.text = "WATCHING"
                binding.statusText.setTextColor(Color.rgb(255, 204, 77))
                binding.reasonText.text = "AI signal rising"
            } else {
                binding.statusText.text = if (running) "ATTENTIVE" else "READY"
                binding.statusText.setTextColor(Color.rgb(53, 224, 138))
                binding.reasonText.text = "No active trigger"
            }
            return
        }

        recoveryStartedMs = null
        lastTriggers = triggers
        if (episodeStartedMs == null) {
            episodeStartedMs = now
            recordEvent("trigger", triggers)
        }
        val primary = primaryTrigger(triggers)
        val elapsed = now - (episodeStartedMs ?: now)
        val (warnMs, alarmMs) = timingFor(primary)
        val reason = triggers.joinToString(" • ") { it.label }

        when {
            elapsed >= alarmMs -> {
                if (!warningSent) {
                    warningSent = true
                    alarmController.warning(primary)
                    recordEvent("warning", triggers)
                }
                if (!alarmSent) {
                    alarmSent = true
                    recordEvent("alarm", triggers)
                }
                alarmController.startAlarm()
                binding.statusText.text = "ALARM"
                binding.statusText.setTextColor(Color.rgb(255, 67, 90))
                binding.reasonText.text = reason
            }
            elapsed >= warnMs -> {
                if (!warningSent) {
                    warningSent = true
                    alarmController.warning(primary)
                    recordEvent("warning", triggers)
                }
                binding.statusText.text = "WARNING"
                binding.statusText.setTextColor(Color.rgb(255, 204, 77))
                binding.reasonText.text = reason
            }
            else -> {
                binding.statusText.text = "CHECKING"
                binding.statusText.setTextColor(Color.rgb(255, 204, 77))
                binding.reasonText.text = reason
            }
        }
    }

    private fun primaryTrigger(triggers: Set<DriverTrigger>): DriverTrigger = when {
        DriverTrigger.EYES_CLOSED in triggers -> DriverTrigger.EYES_CLOSED
        DriverTrigger.PHONE_VISIBLE in triggers -> DriverTrigger.PHONE_VISIBLE
        DriverTrigger.LOOKING_UP_DOWN in triggers -> DriverTrigger.LOOKING_UP_DOWN
        DriverTrigger.HEAD_TURNED in triggers -> DriverTrigger.HEAD_TURNED
        else -> DriverTrigger.FACE_MISSING
    }

    private fun timingFor(trigger: DriverTrigger): Pair<Long, Long> = when (trigger) {
        DriverTrigger.EYES_CLOSED -> 250L to 900L
        DriverTrigger.PHONE_VISIBLE -> 450L to 1450L
        DriverTrigger.FACE_MISSING -> 500L to 1700L
        else -> 450L to 1400L
    }

    private fun clearAlertEpisode() {
        episodeStartedMs = null
        warningSent = false
        alarmSent = false
        recoveryStartedMs = null
        lastTriggers = emptySet()
        alarmController.stopAlarm()
    }

    private fun loadPhoneDetectorAsync() {
        if (phoneDetector != null) return
        binding.phoneStatus.text = "HF PHONE AI: loading YOLOS ONNX…"
        phoneExecutor.execute {
            try {
                val detector = PhoneDetector(this)
                phoneDetector = detector
                runOnUiThread { binding.phoneStatus.text = "HF PHONE AI: ready · Xenova/yolos-tiny" }
            } catch (e: Exception) {
                runOnUiThread { binding.phoneStatus.text = "HF PHONE AI: ${e.message ?: "load failed"}" }
            }
        }
    }

    private fun loadRoadDetectorAsync() {
        if (roadDetector != null) return
        binding.roadGuardPanel.visibility = View.VISIBLE
        binding.roadStatusText.text = "ROAD AI: loading Hugging Face YOLOS…"
        roadInferenceExecutor.execute {
            try {
                val detector = RoadDetector(this)
                roadDetector = detector
                runOnUiThread {
                    binding.roadStatusText.text = if (roadGuardActive) "ROAD AI ready · scanning lane" else "ROAD AI ready · waiting for rear camera"
                }
            } catch (e: Exception) {
                runOnUiThread { binding.roadStatusText.text = "ROAD AI: ${e.message ?: "load failed"}" }
            }
        }
    }

    private fun recordEvent(type: String, triggers: Collection<DriverTrigger>) {
        val labels = triggers.map { it.label }
        tripRecorder.addEvent(type, labels)
        appendEventLog("${type.uppercase()}: ${labels.joinToString(" • ").ifBlank { "drive" }}")
        if (type in setOf("trigger", "warning", "alarm", "phone_detected")) addEventMarker(type, labels)

        val teenResult = TeenModeManager.onEvent(this, type, triggers)
        if (teenResult != null && teenResult != "Parent alert rate-limited") {
            appendEventLog("TEEN: $teenResult")
        }
        updateTripStats()
    }

    private fun recordRoadEvent(detection: RoadDetection) {
        val label = "${detection.label} ahead"
        tripRecorder.addEvent("road_hazard", listOf(label))
        appendEventLog("ROAD HAZARD: $label · ${(detection.confidence * 100).toInt()}%")
        addEventMarker("road_hazard", listOf(label))
        val teenResult = TeenModeManager.onRoadHazard(this, detection.label, detection.risk)
        if (teenResult != null && teenResult != "Parent alert rate-limited") {
            appendEventLog("TEEN: $teenResult")
        }
        updateTripStats()
    }

    private fun appendEventLog(line: String) {
        val old = binding.eventLog.text?.toString().orEmpty()
        binding.eventLog.text = if (old == "No events yet." || old.isBlank()) line else "$line\n$old"
    }

    private fun clearTripMap() {
        routeLine.setPoints(emptyList())
        currentMarker?.let { binding.mapView.overlays.remove(it) }
        currentMarker = null
        eventMarkers.forEach { binding.mapView.overlays.remove(it) }
        eventMarkers.clear()
        binding.eventLog.text = "No events yet."
        updateTripStats()
        binding.mapView.invalidate()
    }

    private fun updateTripMap() {
        val t = tripRecorder.trip ?: return
        routeLine.setPoints(t.route.map { GeoPoint(it.lat, it.lon) })
        val p = tripRecorder.latestPoint ?: return
        val geo = GeoPoint(p.lat, p.lon)
        if (currentMarker == null) {
            currentMarker = Marker(binding.mapView).apply {
                title = "Current location"
                setAnchor(Marker.ANCHOR_CENTER, Marker.ANCHOR_BOTTOM)
                binding.mapView.overlays.add(this)
            }
        }
        currentMarker?.position = geo
        binding.mapView.controller.setZoom(16.0)
        binding.mapView.controller.animateTo(geo)
        binding.mapView.invalidate()
    }

    private fun addEventMarker(type: String, labels: List<String>) {
        val p = tripRecorder.latestPoint ?: return
        val marker = Marker(binding.mapView).apply {
            position = GeoPoint(p.lat, p.lon)
            title = type.uppercase()
            snippet = labels.joinToString(" • ")
            setAnchor(Marker.ANCHOR_CENTER, Marker.ANCHOR_BOTTOM)
        }
        eventMarkers += marker
        binding.mapView.overlays.add(marker)
        binding.mapView.invalidate()
    }

    private fun updateTripStats() {
        val p = tripRecorder.latestPoint
        val mph = ((p?.speedMps ?: 0f) * 2.236936f).roundToInt()
        binding.speedText.text = "$mph mph\nSPEED"
        binding.distanceText.text = "${"%.2f".format(tripRecorder.distanceMiles)} mi\nDISTANCE"
        binding.eventCountText.text = "${tripRecorder.eventCount}\nEVENTS"
    }

    private fun stopDrive() {
        if (!running) return
        running = false
        roadGuardActive = false
        cameraProvider?.unbindAll()
        faceEngine?.reset()
        stopService(Intent(this, DriveMonitorService::class.java))
        clearAlertEpisode()
        TeenModeManager.endDrive()
        teenPreDriveApproved = false
        binding.roadOverlay.clear()
        if (FeatureSettings.enabled(this, FeatureSettings.KEY_REAR_ROAD_GUARD, false)) {
            binding.roadStatusText.text = "Road Guard stopped"
        }
        window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        val saved = tripRecorder.stopAndSave()
        binding.startButton.isEnabled = true
        binding.stopButton.isEnabled = false
        binding.cameraMessage.visibility = View.VISIBLE
        binding.cameraMessage.text = "Drive saved — tap START DRIVE while parked"
        binding.statusText.text = "READY"
        binding.statusText.setTextColor(Color.rgb(53, 224, 138))
        binding.reasonText.text = "Saved locally"
        binding.faceText.text = "WAITING"
        binding.faceDetail.text = "Hugging Face model ready"
        binding.faceOverlay.clearFace()
        Toast.makeText(this, "Drive saved: ${saved?.name ?: "local trip"}", Toast.LENGTH_SHORT).show()
    }

    private fun startFailed(e: Exception) {
        running = false
        roadGuardActive = false
        teenPreDriveApproved = false
        TeenModeManager.endDrive()
        stopService(Intent(this, DriveMonitorService::class.java))
        window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        tripRecorder.stopAndSave()
        binding.startButton.isEnabled = true
        binding.stopButton.isEnabled = false
        binding.statusText.text = "START FAILED"
        binding.statusText.setTextColor(Color.rgb(255, 67, 90))
        binding.reasonText.text = e.message ?: "Camera or AI startup failed"
        binding.faceText.text = "ERROR"
        binding.faceDetail.text = e.message ?: "Hugging Face model error"
        binding.cameraMessage.visibility = View.VISIBLE
        binding.cameraMessage.text = "START FAILED — see error below"
    }

    override fun onResume() {
        super.onResume()
        binding.mapView.onResume()
        binding.phoneCheck.isEnabled = !TeenModeManager.isEnabled(this)
        refreshOptionalFeatureUi()
    }

    override fun onPause() {
        binding.mapView.onPause()
        super.onPause()
    }

    override fun onDestroy() {
        if (running) stopService(Intent(this, DriveMonitorService::class.java))
        try { unregisterReceiver(locationReceiver) } catch (_: Exception) {}
        cameraProvider?.unbindAll()
        faceEngine?.close()
        phoneDetector?.close()
        roadDetector?.close()
        alarmController.close()
        cameraExecutor.shutdownNow()
        phoneExecutor.shutdownNow()
        roadCameraExecutor.shutdownNow()
        roadInferenceExecutor.shutdownNow()
        binding.mapView.onDetach()
        super.onDestroy()
    }
}
