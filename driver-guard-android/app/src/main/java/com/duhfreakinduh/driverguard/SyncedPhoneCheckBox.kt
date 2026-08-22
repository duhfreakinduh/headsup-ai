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
        isChecked = FeatureSettings.enabled(context, FeatureSettings.KEY_PHONE_DETECTION, true)
        setOnCheckedChangeListener { _, checked ->
            if (!syncing) FeatureSettings.setEnabled(context, FeatureSettings.KEY_PHONE_DETECTION, checked)
        }
    }

    override fun onAttachedToWindow() {
        super.onAttachedToWindow()
        prefs.registerOnSharedPreferenceChangeListener(this)
    }

    override fun onDetachedFromWindow() {
        prefs.unregisterOnSharedPreferenceChangeListener(this)
        super.onDetachedFromWindow()
    }

    override fun onSharedPreferenceChanged(sharedPreferences: SharedPreferences?, key: String?) {
        if (key != FeatureSettings.KEY_PHONE_DETECTION) return
        val wanted = FeatureSettings.enabled(context, FeatureSettings.KEY_PHONE_DETECTION, true)
        if (wanted == isChecked) return
        syncing = true
        isChecked = wanted
        syncing = false
    }
}
