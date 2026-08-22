package com.duhfreakinduh.driverguard

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class SmithCoachTest {
    @Test
    fun briefScanCountsWhenDriverReturnsForward() {
        val coach = SmithCoach()
        coach.reset(0)
        coach.update(true, false, 1000)
        val result = coach.update(false, false, 1900)
        assertEquals(1, result.scanCount)
        assertFalse(result.needsScan)
    }

    @Test
    fun prolongedLookIsNotRewardedAsScan() {
        val coach = SmithCoach()
        coach.reset(100)
        coach.update(true, false, 1000)
        val during = coach.update(true, false, 3200)
        assertTrue(during.prolongedLook)
        val result = coach.update(false, false, 4200)
        assertEquals(0, result.scanCount)
    }

    @Test
    fun overdueScanPromptsBigPictureCheck() {
        val coach = SmithCoach()
        coach.reset(1000)
        val result = coach.update(false, false, 11_500)
        assertTrue(result.needsScan)
    }

    @Test
    fun triggeredDistractionDoesNotCountAsGoodScan() {
        val coach = SmithCoach()
        coach.reset(100)
        coach.update(true, false, 1000)
        coach.update(true, true, 2500)
        val result = coach.update(false, false, 2900)
        assertEquals(0, result.scanCount)
    }
}
