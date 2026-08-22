package com.duhfreakinduh.driverguard

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class AttentionPolicyTest {
    @Test
    fun quickBlinkDoesNotTrigger() {
        val p = AttentionPolicy()
        p.update(PolicyInput(true, true, false), 0)
        p.update(PolicyInput(true, true, false), 120)
        val result = p.update(PolicyInput(true, false, false), 180)
        assertFalse(DriverTrigger.EYES_CLOSED in result.triggers)
    }

    @Test
    fun oneSecondEyeClosureDoesNotTrigger() {
        val p = AttentionPolicy()
        var result = p.update(PolicyInput(true, true, false), 0)
        for (time in 100L..1000L step 100L) {
            result = p.update(PolicyInput(true, true, false), time)
        }
        assertFalse(DriverTrigger.EYES_CLOSED in result.triggers)
    }

    @Test
    fun sustainedClosedEyesEventuallyTrigger() {
        val p = AttentionPolicy()
        var result = p.update(PolicyInput(true, true, false), 0)
        for (time in 100L..1400L step 100L) {
            result = p.update(PolicyInput(true, true, false), time)
        }
        assertTrue(DriverTrigger.EYES_CLOSED in result.triggers)
    }

    @Test
    fun threeSecondMirrorGlanceDoesNotTrigger() {
        val p = AttentionPolicy()
        var result = p.update(PolicyInput(true, false, true), 0)
        for (time in 100L..3000L step 100L) {
            result = p.update(PolicyInput(true, false, true), time)
        }
        assertFalse(DriverTrigger.HEAD_TURNED in result.triggers)
        result = p.update(PolicyInput(true, false, false), 3100)
        assertFalse(DriverTrigger.HEAD_TURNED in result.triggers)
    }

    @Test
    fun sustainedHeadTurnEventuallyTriggers() {
        val p = AttentionPolicy()
        var result = p.update(PolicyInput(true, false, true), 0)
        for (time in 100L..4000L step 100L) {
            result = p.update(PolicyInput(true, false, true), time)
        }
        assertTrue(DriverTrigger.HEAD_TURNED in result.triggers)
    }

    @Test
    fun pitchDominantUsesLookingUpDownAfterLongGrace() {
        val p = AttentionPolicy()
        var result = p.update(PolicyInput(true, false, true, true), 0)
        for (time in 100L..4000L step 100L) {
            result = p.update(PolicyInput(true, false, true, true), time)
        }
        assertTrue(DriverTrigger.LOOKING_UP_DOWN in result.triggers)
    }

    @Test
    fun twoPointFiveSecondFaceLossDoesNotTrigger() {
        val p = AttentionPolicy()
        var result = p.update(PolicyInput(false, false, false), 0)
        for (time in 100L..2500L step 100L) {
            result = p.update(PolicyInput(false, false, false), time)
        }
        assertFalse(DriverTrigger.FACE_MISSING in result.triggers)
    }

    @Test
    fun sustainedFaceLossEventuallyTriggers() {
        val p = AttentionPolicy()
        var result = p.update(PolicyInput(false, false, false), 0)
        for (time in 100L..3500L step 100L) {
            result = p.update(PolicyInput(false, false, false), time)
        }
        assertTrue(DriverTrigger.FACE_MISSING in result.triggers)
    }

    @Test
    fun returningForwardClearsMirrorEvidenceFast() {
        val p = AttentionPolicy()
        var result = p.update(PolicyInput(true, false, true), 0)
        for (time in 100L..3000L step 100L) {
            result = p.update(PolicyInput(true, false, true), time)
        }
        assertFalse(DriverTrigger.HEAD_TURNED in result.triggers)
        result = p.update(PolicyInput(true, false, false), 3100)
        result = p.update(PolicyInput(true, false, false), 3200)
        result = p.update(PolicyInput(true, false, false), 3300)
        assertFalse(DriverTrigger.HEAD_TURNED in result.triggers)
        assertTrue(result.awayEvidenceMs < 700f)
    }
}
