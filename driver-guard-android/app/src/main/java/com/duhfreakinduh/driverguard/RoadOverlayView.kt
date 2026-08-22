package com.duhfreakinduh.driverguard

import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Path
import android.util.AttributeSet
import android.view.View

class RoadOverlayView @JvmOverloads constructor(
    context: Context,
    attrs: AttributeSet? = null
) : View(context, attrs) {
    private val lanePaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = Color.argb(190, 92, 184, 255)
        style = Paint.Style.STROKE
        strokeWidth = 4f
    }
    private val boxPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.STROKE
        strokeWidth = 5f
    }
    private val textPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = Color.WHITE
        textSize = 30f
        style = Paint.Style.FILL
    }

    private var detections: List<RoadDetection> = emptyList()

    fun setDetections(value: List<RoadDetection>) {
        detections = value
        invalidate()
    }

    fun clear() {
        detections = emptyList()
        invalidate()
    }

    override fun onDraw(canvas: Canvas) {
        super.onDraw(canvas)
        if (width <= 0 || height <= 0) return

        val lane = Path().apply {
            moveTo(width * 0.39f, height * 0.40f)
            lineTo(width * 0.05f, height.toFloat())
            moveTo(width * 0.61f, height * 0.40f)
            lineTo(width * 0.95f, height.toFloat())
        }
        canvas.drawPath(lane, lanePaint)

        detections.forEach { detection ->
            val b = detection.box
            val left = (b.centerX - b.width / 2f).coerceIn(0f, 1f) * width
            val top = (b.centerY - b.height / 2f).coerceIn(0f, 1f) * height
            val right = (b.centerX + b.width / 2f).coerceIn(0f, 1f) * width
            val bottom = (b.centerY + b.height / 2f).coerceIn(0f, 1f) * height
            boxPaint.color = when (detection.risk) {
                RoadRisk.HAZARD -> Color.rgb(255, 67, 90)
                RoadRisk.WATCH -> Color.rgb(255, 204, 77)
                RoadRisk.NONE -> Color.rgb(92, 184, 255)
            }
            canvas.drawRect(left, top, right, bottom, boxPaint)
            canvas.drawText(
                "${detection.label} ${(detection.confidence * 100).toInt()}%",
                left.coerceAtLeast(6f),
                (top - 8f).coerceAtLeast(30f),
                textPaint
            )
        }
    }
}
