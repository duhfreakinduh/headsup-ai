package com.duhfreakinduh.driverguard

import android.Manifest
import android.content.pm.PackageManager
import android.graphics.Color
import android.os.Bundle
import android.text.InputType
import android.view.ViewGroup
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import android.widget.Toast
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.appcompat.widget.SwitchCompat
import androidx.core.content.ContextCompat

class SettingsActivity : AppCompatActivity() {
    private lateinit var root: LinearLayout
    private var adultUnlocked = false
    private var smsTestPending = false

    private val smsPermissionLauncher = registerForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { granted ->
        if (granted) {
            if (smsTestPending) {
                Toast.makeText(this, TeenModeManager.sendTestAlert(this), Toast.LENGTH_LONG).show()
            } else {
                Toast.makeText(this, "SMS permission enabled for Teen Mode parent alerts.", Toast.LENGTH_LONG).show()
            }
        } else {
            Toast.makeText(this, "SMS permission denied — automatic parent texts cannot be sent.", Toast.LENGTH_LONG).show()
        }
        smsTestPending = false
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        val scroll = ScrollView(this).apply {
            setBackgroundColor(Color.parseColor("#07111F"))
            isFillViewport = true
        }
        root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(16), dp(18), dp(16), dp(28))
        }
        scroll.addView(root, ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT))
        setContentView(scroll)
        buildUi()
    }

    private fun buildUi() {
        root.removeAllViews()
        val teenOn = TeenModeManager.isEnabled(this)
        val hasPin = TeenModeManager.hasPin(this)
        val safetyLocked = teenOn && !adultUnlocked

        root.addView(TextView(this).apply {
            text = "DRIVER GUARD AI"
            setTextColor(Color.parseColor("#35E08A"))
            textSize = 12f
        })
        root.addView(TextView(this).apply {
            text = "Settings"
            setTextColor(Color.WHITE)
            textSize = 28f
            setPadding(0, dp(2), 0, dp(10))
        })
        root.addView(TextView(this).apply {
            text = "Core face / eye / head monitoring is not changed here. Settings only control optional features. Configure while parked."
            setTextColor(Color.WHITE)
            textSize = 13f
            setBackgroundColor(Color.parseColor("#24334A"))
            setPadding(dp(12), dp(12), dp(12), dp(12))
        })

        section("CORE PROTECTION")
        addLockedSwitch(
            "Core driver monitoring",
            "Always ON. Face, eyes and head-attention detection remain part of the core app."
        )

        section("ADULT LOCK")
        root.addView(TextView(this).apply {
            text = when {
                !hasPin -> "No adult PIN is set yet. Teen Mode cannot be enabled until an adult creates one."
                adultUnlocked -> "Adult controls are unlocked for this Settings session."
                teenOn -> "Teen Mode is active. Safety settings are locked. Enter the adult PIN to make changes."
                else -> "An adult PIN exists. Unlock it to change Teen Mode or parent alert rules."
            }
            setTextColor(Color.parseColor("#8FA8C2"))
            textSize = 12f
        })
        root.addView(Button(this).apply {
            text = when {
                !hasPin -> "SET ADULT PIN"
                adultUnlocked -> "CHANGE ADULT PIN"
                else -> "UNLOCK ADULT SETTINGS"
            }
            setOnClickListener {
                when {
                    !TeenModeManager.hasPin(this@SettingsActivity) -> showSetPinDialog()
                    adultUnlocked -> showSetPinDialog(changing = true)
                    else -> showUnlockDialog()
                }
            }
        })

        section("OPTIONAL FEATURES")
        addSettingSwitch(
            "Visible phone detection",
            "Run the Hugging Face YOLOS phone detector on the driver-facing camera.",
            FeatureSettings.KEY_PHONE_DETECTION,
            true,
            !safetyLocked
        )
        addSettingSwitch(
            "Spoken warnings",
            "Voice prompts such as Eyes on the road and Road Guard hazard warnings.",
            FeatureSettings.KEY_VOICE_WARNINGS,
            true,
            !safetyLocked
        )
        addSettingSwitch(
            "Vibration",
            "Vibrate on warnings and alarms.",
            FeatureSettings.KEY_VIBRATION,
            true,
            !safetyLocked
        )
        addSettingSwitch(
            "Loud alarm tone",
            "Play the repeating alarm tone after a sustained driver-attention trigger.",
            FeatureSettings.KEY_ALARM_TONE,
            true,
            !safetyLocked
        )
        addSettingSwitch(
            "Smith driving coach",
            "Encourages brief mirror/window scanning and the Smith-style big-picture habit without changing the core distraction detector.",
            FeatureSettings.KEY_SMITH_COACH,
            false,
            !safetyLocked
        )
        addSettingSwitch(
            "Rear Road Guard",
            "Use the rear camera alongside the front camera when this phone supports concurrent front + rear CameraX streams.",
            FeatureSettings.KEY_REAR_ROAD_GUARD,
            false,
            !safetyLocked
        )
        addSettingSwitch(
            "Road hazard alerts",
            "When Rear Road Guard sees a supported vehicle or road user in the forward-lane corridor, allow audible/vibration hazard warnings and trip events.",
            FeatureSettings.KEY_ROAD_HAZARDS,
            false,
            !safetyLocked
        )
        root.addView(TextView(this).apply {
            text = "Road Guard v1 recognizes selected YOLOS/COCO road users and vehicles such as people, bicycles, cars, motorcycles, buses and trucks. It does not claim reliable pothole or debris detection yet."
            setTextColor(Color.parseColor("#8FA8C2"))
            textSize = 12f
            setPadding(0, 0, 0, dp(6))
        })

        section("TEEN MODE — ADULT CONTROLLED")
        root.addView(TextView(this).apply {
            text = "Teen Mode requires a pre-drive Teen Check, locks safety settings behind the adult PIN, counts driving issues, and can automatically text the saved parent number after a major event or too many warnings. The app cannot physically prevent the vehicle from being driven."
            setTextColor(Color.WHITE)
            textSize = 12f
            setBackgroundColor(Color.parseColor("#24334A"))
            setPadding(dp(10), dp(10), dp(10), dp(10))
        })

        val teenSwitchBox = settingBox()
        teenSwitchBox.addView(SwitchCompat(this).apply {
            text = "Teen Mode"
            setTextColor(Color.WHITE)
            textSize = 17f
            isChecked = teenOn
            isEnabled = hasPin && adultUnlocked
            setOnCheckedChangeListener { button, enabled ->
                if (!button.isPressed) return@setOnCheckedChangeListener
                if (!adultUnlocked) {
                    button.isChecked = TeenModeManager.isEnabled(this@SettingsActivity)
                    return@setOnCheckedChangeListener
                }
                if (enabled && FeatureSettings.string(this@SettingsActivity, FeatureSettings.KEY_TEEN_PARENT_PHONE).filter { it.isDigit() }.length < 7) {
                    Toast.makeText(this@SettingsActivity, "Save the parent phone number before enabling Teen Mode.", Toast.LENGTH_LONG).show()
                    button.isChecked = false
                    return@setOnCheckedChangeListener
                }
                FeatureSettings.setEnabled(this@SettingsActivity, FeatureSettings.KEY_TEEN_MODE, enabled)
                if (enabled) requestSmsPermissionIfNeeded(false)
                buildUi()
            }
        })
        teenSwitchBox.addView(description(if (!hasPin) "Set the adult PIN first." else "Only an adult who knows the PIN can turn this mode on or off."))

        val parentPhone = EditText(this).apply {
            hint = "Parent mobile number"
            setHintTextColor(Color.parseColor("#8FA8C2"))
            setTextColor(Color.WHITE)
            inputType = InputType.TYPE_CLASS_PHONE
            setText(FeatureSettings.string(this@SettingsActivity, FeatureSettings.KEY_TEEN_PARENT_PHONE))
            isEnabled = hasPin && adultUnlocked
        }
        val eventLimit = EditText(this).apply {
            hint = "Warnings before parent alert (1–20)"
            setHintTextColor(Color.parseColor("#8FA8C2"))
            setTextColor(Color.WHITE)
            inputType = InputType.TYPE_CLASS_NUMBER
            setText(FeatureSettings.int(this@SettingsActivity, FeatureSettings.KEY_TEEN_EVENT_LIMIT, 3).toString())
            isEnabled = hasPin && adultUnlocked
        }
        val configBox = settingBox()
        configBox.addView(parentPhone)
        configBox.addView(eventLimit)
        configBox.addView(description("SMS is sent directly from the teen phone. Carrier messaging charges may apply. No cloud parent account is required for this version."))

        addTeenMajorSwitch("Major: any full Driver Guard alarm", FeatureSettings.KEY_TEEN_MAJOR_ALARM, true, hasPin && adultUnlocked)
        addTeenMajorSwitch("Major: sustained eyes-closed alarm", FeatureSettings.KEY_TEEN_MAJOR_EYES, true, hasPin && adultUnlocked)
        addTeenMajorSwitch("Major: visible phone detected", FeatureSettings.KEY_TEEN_MAJOR_PHONE, true, hasPin && adultUnlocked)
        addTeenMajorSwitch("Major: Road Guard forward-lane hazard", FeatureSettings.KEY_TEEN_MAJOR_ROAD, true, hasPin && adultUnlocked)

        root.addView(Button(this).apply {
            text = "SAVE TEEN SETTINGS"
            isEnabled = hasPin && adultUnlocked
            setOnClickListener {
                val phone = parentPhone.text.toString().trim()
                val digits = phone.filter { it.isDigit() }
                val limit = eventLimit.text.toString().toIntOrNull()?.coerceIn(1, 20) ?: 3
                if (digits.length < 7) {
                    Toast.makeText(this@SettingsActivity, "Enter a valid parent mobile number.", Toast.LENGTH_LONG).show()
                    return@setOnClickListener
                }
                FeatureSettings.setString(this@SettingsActivity, FeatureSettings.KEY_TEEN_PARENT_PHONE, phone)
                FeatureSettings.setInt(this@SettingsActivity, FeatureSettings.KEY_TEEN_EVENT_LIMIT, limit)
                Toast.makeText(this@SettingsActivity, "Teen Mode settings saved.", Toast.LENGTH_SHORT).show()
                requestSmsPermissionIfNeeded(false)
                buildUi()
            }
        })

        root.addView(Button(this).apply {
            text = "TEST PARENT SMS"
            isEnabled = hasPin && adultUnlocked && FeatureSettings.string(this@SettingsActivity, FeatureSettings.KEY_TEEN_PARENT_PHONE).filter { it.isDigit() }.length >= 7
            setOnClickListener { requestSmsPermissionIfNeeded(true) }
        })

        root.addView(Button(this).apply {
            text = "BACK TO DRIVER GUARD"
            setOnClickListener { finish() }
        }, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
            topMargin = dp(18)
        })
    }

    private fun showSetPinDialog(changing: Boolean = false) {
        val box = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(20), 0, dp(20), 0)
        }
        val pin = EditText(this).apply {
            hint = "4–8 digit adult PIN"
            inputType = InputType.TYPE_CLASS_NUMBER or InputType.TYPE_NUMBER_VARIATION_PASSWORD
        }
        val confirm = EditText(this).apply {
            hint = "Confirm PIN"
            inputType = InputType.TYPE_CLASS_NUMBER or InputType.TYPE_NUMBER_VARIATION_PASSWORD
        }
        box.addView(pin)
        box.addView(confirm)

        AlertDialog.Builder(this)
            .setTitle(if (changing) "Change adult PIN" else "Set adult PIN")
            .setMessage("The PIN protects Teen Mode and its parent controls. Do not share it with the teen driver.")
            .setView(box)
            .setNegativeButton("Cancel", null)
            .setPositiveButton("Save") { _, _ ->
                val p1 = pin.text.toString()
                val p2 = confirm.text.toString()
                if (p1 != p2 || !TeenModeManager.setPin(this, p1)) {
                    Toast.makeText(this, "PINs must match and contain 4–8 digits.", Toast.LENGTH_LONG).show()
                } else {
                    adultUnlocked = true
                    Toast.makeText(this, "Adult PIN saved.", Toast.LENGTH_SHORT).show()
                    buildUi()
                }
            }
            .show()
    }

    private fun showUnlockDialog() {
        val pin = EditText(this).apply {
            hint = "Adult PIN"
            inputType = InputType.TYPE_CLASS_NUMBER or InputType.TYPE_NUMBER_VARIATION_PASSWORD
        }
        AlertDialog.Builder(this)
            .setTitle("Unlock adult settings")
            .setView(pin)
            .setNegativeButton("Cancel", null)
            .setPositiveButton("Unlock") { _, _ ->
                if (TeenModeManager.verifyPin(this, pin.text.toString())) {
                    adultUnlocked = true
                    buildUi()
                } else {
                    Toast.makeText(this, "Incorrect adult PIN.", Toast.LENGTH_LONG).show()
                }
            }
            .show()
    }

    private fun requestSmsPermissionIfNeeded(sendTestAfterGrant: Boolean) {
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.SEND_SMS) == PackageManager.PERMISSION_GRANTED) {
            if (sendTestAfterGrant) Toast.makeText(this, TeenModeManager.sendTestAlert(this), Toast.LENGTH_LONG).show()
            return
        }
        smsTestPending = sendTestAfterGrant
        if (!sendTestAfterGrant) {
            Toast.makeText(this, "Allow SMS permission so Teen Mode can automatically alert the parent.", Toast.LENGTH_LONG).show()
        }
        smsPermissionLauncher.launch(Manifest.permission.SEND_SMS)
    }

    private fun section(title: String) {
        root.addView(TextView(this).apply {
            text = title
            setTextColor(Color.parseColor("#5CB8FF"))
            textSize = 12f
            setPadding(0, dp(18), 0, dp(6))
        })
    }

    private fun addLockedSwitch(title: String, descriptionText: String) {
        val box = settingBox()
        box.addView(SwitchCompat(this).apply {
            text = title
            setTextColor(Color.WHITE)
            textSize = 16f
            isChecked = true
            isEnabled = false
        })
        box.addView(description(descriptionText))
    }

    private fun addSettingSwitch(
        title: String,
        descriptionText: String,
        key: String,
        defaultValue: Boolean,
        editable: Boolean
    ) {
        val box = settingBox()
        box.addView(SwitchCompat(this).apply {
            text = title
            setTextColor(Color.WHITE)
            textSize = 16f
            isChecked = FeatureSettings.enabled(this@SettingsActivity, key, defaultValue)
            isEnabled = editable
            setOnCheckedChangeListener { _, enabled ->
                if (isEnabled) FeatureSettings.setEnabled(this@SettingsActivity, key, enabled)
            }
        })
        box.addView(description(descriptionText))
    }

    private fun addTeenMajorSwitch(title: String, key: String, defaultValue: Boolean, editable: Boolean) {
        val box = settingBox()
        box.addView(SwitchCompat(this).apply {
            text = title
            setTextColor(Color.WHITE)
            textSize = 15f
            isChecked = FeatureSettings.enabled(this@SettingsActivity, key, defaultValue)
            isEnabled = editable
            setOnCheckedChangeListener { _, enabled ->
                if (isEnabled) FeatureSettings.setEnabled(this@SettingsActivity, key, enabled)
            }
        })
    }

    private fun settingBox(): LinearLayout {
        val box = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(Color.parseColor("#142235"))
            setPadding(dp(12), dp(10), dp(12), dp(10))
        }
        root.addView(box, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
            bottomMargin = dp(8)
        })
        return box
    }

    private fun description(textValue: String) = TextView(this).apply {
        text = textValue
        setTextColor(Color.parseColor("#8FA8C2"))
        textSize = 12f
        setPadding(0, dp(4), 0, 0)
    }

    private fun dp(value: Int): Int = (value * resources.displayMetrics.density).toInt()
}
