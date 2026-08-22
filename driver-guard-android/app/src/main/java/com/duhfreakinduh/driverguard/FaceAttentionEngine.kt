package com.duhfreakinduh.driverguard

import android.content.Context
import android.graphics.Bitmap
import android.os.SystemClock
import com.google.mediapipe.framework.image.BitmapImageBuilder
import com.google.mediapipe.tasks.core.BaseOptions
import com.google.mediapipe.tasks.core.Delegate
import com.google.mediapipe.tasks.vision.core.RunningMode
import com.google.mediapipe.tasks.vision.facelandmarker.FaceLandmarker
import kotlin.math.abs
import kotlin.math.hypot
import kotlin.math.max

private data class FaceMetrics(
    val yaw: Float,
    val pitch: Float,
    val ear: Float,
    val leftEar: Float,
    val rightEar: Float,
    val blinkLeft: Float,
    val blinkRight: Float
) {
    val blinkAvg: Float get() = (blinkLeft + blinkRight) / 2f
}

private data class Baseline(
    var yaw: Float,
    var pitch: Float,
    var ear: Float,
    var blink: Float
)

data class FaceAnalysis(
    val calibrated: Boolean,
    val hasFace: Boolean,
    val triggers: Set<DriverTrigger>,
    val rawEyesClosed: Boolean,
    val rawAway: Boolean,
    val detail: String,
    val normalizedPoints: List<Pair<Float, Float>>,
    val inferenceMs: Long
)

class FaceAttentionEngine(context: Context) : AutoCloseable {
    private val policy = AttentionPolicy()
    private val faceLandmarker: FaceLandmarker
    private val calibration = ArrayDeque<Pair<Long, FaceMetrics>>()
    private var baseline: Baseline? = null

    init {
        val base = BaseOptions.builder()
            .setModelAssetPath("face_landmarker.task")
            .setDelegate(Delegate.CPU)
            .build()
        val options = FaceLandmarker.FaceLandmarkerOptions.builder()
            .setBaseOptions(base)
            .setRunningMode(RunningMode.IMAGE)
            .setNumFaces(1)
            .setMinFaceDetectionConfidence(0.25f)
            .setMinFacePresenceConfidence(0.25f)
            .setMinTrackingConfidence(0.25f)
            .setOutputFaceBlendshapes(true)
            .setOutputFacialTransformationMatrixes(false)
            .build()
        faceLandmarker = FaceLandmarker.createFromOptions(context, options)
    }

    fun reset() {
        calibration.clear()
        baseline = null
        policy.reset()
    }

    fun analyze(bitmap: Bitmap, timestampMs: Long = SystemClock.uptimeMillis()): FaceAnalysis {
        val started = SystemClock.elapsedRealtime()
        val result = faceLandmarker.detect(BitmapImageBuilder(bitmap).build())
        val landmarks = result.faceLandmarks().firstOrNull()

        if (landmarks == null || landmarks.size < 292) {
            calibration.clear()
            val decision = policy.update(
                PolicyInput(hasFace = false, rawEyesClosed = false, rawAway = false),
                timestampMs
            )
            return FaceAnalysis(
                calibrated = baseline != null,
                hasFace = false,
                triggers = decision.triggers,
                rawEyesClosed = false,
                rawAway = false,
                detail = "HF face missing ${decision.missingEvidenceMs.toInt()} ms",
                normalizedPoints = emptyList(),
                inferenceMs = SystemClock.elapsedRealtime() - started
            )
        }

        val blend = mutableMapOf<String, Float>()
        val blendshapes = result.faceBlendshapes()
        if (blendshapes.isPresent && blendshapes.get().isNotEmpty()) {
            for (category in blendshapes.get().first()) {
                blend[category.categoryName()] = category.score()
            }
        }

        fun p(i: Int) = landmarks[i]
        fun d(a: Int, b: Int): Float = hypot(
            (p(a).x() - p(b).x()).toDouble(),
            (p(a).y() - p(b).y()).toDouble()
        ).toFloat()
        fun ear(indices: IntArray): Float {
            val a = d(indices[1], indices[5])
            val b = d(indices[2], indices[4])
            val c = max(0.0001f, d(indices[0], indices[3]))
            return (a + b) / (2f * c)
        }

        val leftOuter = p(33)
        val rightOuter = p(263)
        val nose = p(1)
        val eyeMidX = (leftOuter.x() + rightOuter.x()) / 2f
        val eyeMidY = (leftOuter.y() + rightOuter.y()) / 2f
        val mouthMidY = (p(61).y() + p(291).y()) / 2f
        val eyeSpan = max(0.001f, abs(rightOuter.x() - leftOuter.x()))
        val leftEar = ear(intArrayOf(33, 160, 158, 133, 153, 144))
        val rightEar = ear(intArrayOf(362, 385, 387, 263, 373, 380))
        val metrics = FaceMetrics(
            yaw = (nose.x() - eyeMidX) / eyeSpan,
            pitch = (nose.y() - eyeMidY) / max(0.001f, mouthMidY - eyeMidY),
            ear = (leftEar + rightEar) / 2f,
            leftEar = leftEar,
            rightEar = rightEar,
            blinkLeft = blend["eyeBlinkLeft"] ?: 0f,
            blinkRight = blend["eyeBlinkRight"] ?: 0f
        )

        val b = baseline
        val rawEyes = if (b == null) {
            metrics.blinkAvg >= 0.48f ||
                (metrics.blinkLeft > 0.45f && metrics.blinkRight > 0.45f) ||
                (metrics.ear in 0.001f..0.155f)
        } else {
            val blinkThreshold = max(0.36f, b.blink + 0.15f).coerceAtMost(0.62f)
            val earThreshold = max(0.03f, b.ear * 0.67f)
            metrics.blinkAvg >= blinkThreshold ||
                (metrics.blinkLeft > 0.42f && metrics.blinkRight > 0.42f) ||
                (metrics.ear > 0f && metrics.ear < earThreshold)
        }

        var rawAway = false
        var pitchDominant = false
        if (b != null) {
            val yawDelta = abs(metrics.yaw - b.yaw)
            val pitchDelta = abs(metrics.pitch - b.pitch)
            rawAway = yawDelta > 0.07f || pitchDelta > 0.10f
            pitchDominant = pitchDelta > 0.10f && pitchDelta >= yawDelta
        }

        val decision = policy.update(
            PolicyInput(
                hasFace = true,
                rawEyesClosed = rawEyes,
                rawAway = rawAway,
                pitchDominant = pitchDominant
            ),
            timestampMs
        )

        if (b == null) {
            if (!rawEyes && metrics.blinkAvg < 0.25f && metrics.ear > 0.15f) {
                calibration.addLast(timestampMs to metrics)
                while (calibration.size > 45) calibration.removeFirst()
                val first = calibration.firstOrNull()?.first ?: timestampMs
                if (timestampMs - first >= 1200 && calibration.size >= 8) {
                    baseline = Baseline(
                        yaw = median(calibration.map { it.second.yaw }),
                        pitch = median(calibration.map { it.second.pitch }),
                        ear = median(calibration.map { it.second.ear }),
                        blink = median(calibration.map { it.second.blinkAvg })
                    )
                    policy.reset()
                }
            } else if (rawEyes) {
                calibration.clear()
            }
        } else if (!rawEyes && !rawAway && decision.triggers.isEmpty()) {
            val alpha = 0.008f
            b.yaw += (metrics.yaw - b.yaw) * alpha
            b.pitch += (metrics.pitch - b.pitch) * alpha
            b.ear += (metrics.ear - b.ear) * alpha
            b.blink += (metrics.blinkAvg - b.blink) * alpha
        }

        val points = landmarks.map { it.x() to it.y() }
        val detail = if (baseline == null) {
            "HF calibrating · blink ${(metrics.blinkAvg * 100).toInt()}% · eye ${"%.2f".format(metrics.ear)} · ${calibration.size} clean frames"
        } else {
            val eyeProgress = ((decision.eyeEvidenceMs / AttentionPolicy.EYE_TRIGGER_MS) * 100f).toInt().coerceIn(0, 100)
            val turnProgress = ((decision.awayEvidenceMs / AttentionPolicy.AWAY_TRIGGER_MS) * 100f).toInt().coerceIn(0, 100)
            "HF blink ${(metrics.blinkAvg * 100).toInt()}% · eye ${"%.2f".format(metrics.ear)} · eye ${eyeProgress}% · turn ${turnProgress}%"
        }

        return FaceAnalysis(
            calibrated = baseline != null,
            hasFace = true,
            triggers = decision.triggers,
            rawEyesClosed = rawEyes,
            rawAway = rawAway,
            detail = detail,
            normalizedPoints = points,
            inferenceMs = SystemClock.elapsedRealtime() - started
        )
    }

    override fun close() {
        faceLandmarker.close()
    }

    private fun median(values: List<Float>): Float {
        if (values.isEmpty()) return 0f
        val sorted = values.sorted()
        val mid = sorted.size / 2
        return if (sorted.size % 2 == 1) sorted[mid] else (sorted[mid - 1] + sorted[mid]) / 2f
    }
}
