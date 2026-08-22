package com.duhfreakinduh.driverguard

import android.content.Context
import android.content.SharedPreferences
import android.util.AttributeSet
import androidx.appcompat.widget.AppCompatCheckBox

class SyncedPhoneCheckBox @JvmOverloads constructor(
    context: Context,
    attrs: AttributeSet? = null,
    defStyleAttr: Int = android.R.attr.checkboxStyle
) : AppCompatCheckBox(context, attrs, defStyleAttr), SharedPreferences.OnSharedPreferenceChangeListener {

    private val prefs = context.getSharedPreferences(FeatureSettings.PREFS, Context.MODE_PRIVATE)
    private var syncing = false

    init {
        syncState()
        setOnCheckedChangeListener { _, checked ->
            if (!syncing && !TeenModeManager.isEnabled(context)) {
                FeatureSettings.setEnabled(context, FeatureSettings.KEY_PHONE_DETECTION, checked)
            } else if (!syncing && TeenModeManager.isEnabled(context)) {
                syncState()
            }
        }
    }

    override fun onAttachedToWindow() {
        super.onAttachedToWindow()
        prefs.registerOnSharedPreferenceChangeListener(this)
        syncState()
    }

    override fun onDetachedFromWindow() {
        prefs.unregisterOnSharedPreferenceChangeListener(this)
        super.onDetachedFromWindow()
    }

    override fun onSharedPreferenceChanged(sharedPreferences: SharedPreferences?, key: String?) {
        if (key == FeatureSettings.KEY_PHONE_DETECTION || key == FeatureSettings.KEY_TEEN_MODE) {
            syncState()
        }
    }

    private fun syncState() {
        syncing = true
        isChecked = FeatureSettings.enabled(context, FeatureSettings.KEY_PHONE_DETECTION, true)
        isEnabled = !TeenModeManager.isEnabled(context)
        alpha = if (isEnabled) 1f else 0.6f
        syncing = false
    }
}
