package com.duhfreakinduh.driverguard

import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.util.AttributeSet
import android.view.View

class FaceOverlayView @JvmOverloads constructor(
    context: Context,
    attrs: AttributeSet? = null
) : View(context, attrs) {
    private var points: List<Pair<Float, Float>> = emptyList()
    private var danger = false
    private val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.STROKE
        strokeWidth = 5f
    }
    private val dotPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.FILL
    }

    fun setFace(normalized: List<Pair<Float, Float>>, isDanger: Boolean) {
        points = normalized
        danger = isDanger
        postInvalidateOnAnimation()
    }

    fun clearFace() = setFace(emptyList(), false)

    override fun onDraw(canvas: Canvas) {
        super.onDraw(canvas)
        if (points.isEmpty()) return
        var minX = 1f
        var minY = 1f
        var maxX = 0f
        var maxY = 0f
        for ((x, y) in points) {
            minX = minOf(minX, x)
            minY = minOf(minY, y)
            maxX = maxOf(maxX, x)
            maxY = maxOf(maxY, y)
        }
        val color = if (danger) Color.rgb(255, 67, 90) else Color.rgb(53, 224, 138)
        paint.color = color
        dotPaint.color = color
        canvas.drawRect(minX * width, minY * height, maxX * width, maxY * height, paint)
        for (index in intArrayOf(33, 133, 362, 263)) {
            val p = points.getOrNull(index) ?: continue
            canvas.drawCircle(p.first * width, p.second * height, 6f, dotPaint)
        }
    }
}
