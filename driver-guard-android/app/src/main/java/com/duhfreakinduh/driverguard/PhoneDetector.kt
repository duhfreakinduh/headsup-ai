package com.duhfreakinduh.driverguard

import ai.onnxruntime.OnnxTensor
import ai.onnxruntime.OrtEnvironment
import ai.onnxruntime.OrtSession
import android.content.Context
import android.graphics.Bitmap
import java.nio.FloatBuffer
import kotlin.math.exp
import kotlin.math.max
import kotlin.math.roundToInt

class PhoneDetector(context: Context) : AutoCloseable {
    private val env: OrtEnvironment = OrtEnvironment.getEnvironment()
    private val session: OrtSession
    private val inputName: String

    init {
        val bytes = context.assets.open("yolos_tiny_quantized.onnx").use { it.readBytes() }
        session = env.createSession(bytes)
        inputName = session.inputNames.first()
    }

    fun detectPhone(bitmap: Bitmap): Float {
        val shortest = minOf(bitmap.width, bitmap.height)
        val scale = 512f / shortest.toFloat()
        var targetW = (bitmap.width * scale).roundToInt().coerceAtLeast(1)
        var targetH = (bitmap.height * scale).roundToInt().coerceAtLeast(1)
        val longest = max(targetW, targetH)
        if (longest > 1333) {
            val secondScale = 1333f / longest.toFloat()
            targetW = (targetW * secondScale).roundToInt().coerceAtLeast(1)
            targetH = (targetH * secondScale).roundToInt().coerceAtLeast(1)
        }

        val resized = Bitmap.createScaledBitmap(bitmap, targetW, targetH, true)
        val pixels = IntArray(targetW * targetH)
        resized.getPixels(pixels, 0, targetW, 0, 0, targetW, targetH)
        if (resized !== bitmap) resized.recycle()

        val plane = targetW * targetH
        val data = FloatArray(plane * 3)
        val mean = floatArrayOf(0.485f, 0.456f, 0.406f)
        val std = floatArrayOf(0.229f, 0.224f, 0.225f)
        for (i in pixels.indices) {
            val color = pixels[i]
            val r = ((color shr 16) and 0xff) / 255f
            val g = ((color shr 8) and 0xff) / 255f
            val b = (color and 0xff) / 255f
            data[i] = (r - mean[0]) / std[0]
            data[plane + i] = (g - mean[1]) / std[1]
            data[plane * 2 + i] = (b - mean[2]) / std[2]
        }

        val shape = longArrayOf(1, 3, targetH.toLong(), targetW.toLong())
        OnnxTensor.createTensor(env, FloatBuffer.wrap(data), shape).use { input ->
            session.run(mapOf(inputName to input)).use { output ->
                @Suppress("UNCHECKED_CAST")
                val logits = output[0].value as Array<Array<FloatArray>>
                var bestPhone = 0f
                for (query in logits[0]) {
                    var maxLogit = Float.NEGATIVE_INFINITY
                    for (v in query) if (v > maxLogit) maxLogit = v
                    var denom = 0.0
                    for (v in query) denom += exp((v - maxLogit).toDouble())
                    if (query.size > CELL_PHONE_CLASS) {
                        val p = (exp((query[CELL_PHONE_CLASS] - maxLogit).toDouble()) / denom).toFloat()
                        if (p > bestPhone) bestPhone = p
                    }
                }
                return bestPhone
            }
        }
    }

    override fun close() {
        session.close()
    }

    companion object {
        const val CELL_PHONE_CLASS = 77
    }
}
