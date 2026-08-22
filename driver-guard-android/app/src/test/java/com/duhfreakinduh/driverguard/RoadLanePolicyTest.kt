package com.duhfreakinduh.driverguard

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class RoadLanePolicyTest {
    @Test
    fun largeCenteredCarIsHazard() {
        val box = NormalizedRoadBox(0.5f, 0.70f, 0.30f, 0.28f)
        assertTrue(RoadLanePolicy.isInForwardLane(box))
        assertEquals(RoadRisk.HAZARD, RoadLanePolicy.risk("car", box))
    }

    @Test
    fun vehicleBesideLaneIsIgnored() {
        val box = NormalizedRoadBox(0.92f, 0.72f, 0.18f, 0.26f)
        assertFalse(RoadLanePolicy.isInForwardLane(box))
        assertEquals(RoadRisk.NONE, RoadLanePolicy.risk("car", box))
    }

    @Test
    fun mediumVehicleAheadIsWatch() {
        val box = NormalizedRoadBox(0.51f, 0.54f, 0.15f, 0.15f)
        assertEquals(RoadRisk.WATCH, RoadLanePolicy.risk("truck", box))
    }

    @Test
    fun nearPedestrianInLaneIsHazard() {
        val box = NormalizedRoadBox(0.48f, 0.70f, 0.10f, 0.20f)
        assertEquals(RoadRisk.HAZARD, RoadLanePolicy.risk("person", box))
    }

    @Test
    fun distantObjectIsNotAlerted() {
        val box = NormalizedRoadBox(0.50f, 0.34f, 0.08f, 0.08f)
        assertEquals(RoadRisk.NONE, RoadLanePolicy.risk("car", box))
    }
}
