package com.duhfreakinduh.driverguard

import kotlin.math.abs

data class NormalizedRoadBox(
    val centerX: Float,
    val centerY: Float,
    val width: Float,
    val height: Float
) {
    val bottom: Float get() = (centerY + height / 2f).coerceIn(0f, 1f)
    val area: Float get() = (width * height).coerceAtLeast(0f)
}

enum class RoadRisk { NONE, WATCH, HAZARD }

object RoadLanePolicy {
    fun isInForwardLane(box: NormalizedRoadBox): Boolean {
        if (box.bottom < 0.40f) return false
        val t = ((box.bottom - 0.40f) / 0.60f).coerceIn(0f, 1f)
        val halfWidth = 0.11f + (0.34f * t)
        return abs(box.centerX - 0.5f) <= halfWidth
    }

    fun risk(label: String, box: NormalizedRoadBox): RoadRisk {
        if (!isInForwardLane(box)) return RoadRisk.NONE
        val vulnerable = label == "person" || label == "bicycle" || label == "motorcycle"
        if (box.bottom >= 0.76f && (box.height >= 0.20f || box.area >= 0.025f || vulnerable)) {
            return RoadRisk.HAZARD
        }
        if (box.bottom >= 0.56f && (box.height >= 0.10f || box.area >= 0.008f)) {
            return RoadRisk.WATCH
        }
        return RoadRisk.NONE
    }
}
