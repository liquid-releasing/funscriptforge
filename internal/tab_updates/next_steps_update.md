# Multiple audio outputs

For user guide docs?

https://discuss.eroscripts.com/t/running-multiple-restim-instances-at-once/174873

## Routing audio (Stereostim)

Because each restim instance takes exclusive control of an audio device, this requires multiple physical audio devices, or multiple virtual audio devices. Physical audio devices are much simpler to get set up, but requires as many audio devices as restim instances you want to run.

## Physical

For each instance of restim you are running, you must configure the audio device.
Go to Tools → Preferences → Audio → Output Device, and select the corresponding physical audio device for that restim instance.

## Virtual

There are many ways to do this, but I’m sharing the method I personally use. Voicemeeter Banana provides you with virtual audio output devices that can be combined and sent as a multi-channel signal to your physical audio device. As far as I can tell, this is limited to two virtual output devices. Sorry.

For each instance of restim you are running, you must configure the audio device.
Go to Tools → Preferences → Audio → Output Device, and select the corresponding Voicemeeter virtual audio device for that restim instance.

In Voicemeeter:

1 Set your output audio device. This should be the device you are hooking up to your estim box.
2 Ensure that your audio inputs to Voicemeeter (the devices that restim is using as outputs) are outputting to that same audio device.
3 Make sure all unused audio inputs are not routed into that device.
4 Set your output device to “Composite”
5 Hit Menu → System Settings 

Running different scripts for different electrodes
If you want to really maximize the potential of this setup, you can have separate scripts for your different electrode sets. This can be done by changing the scripts that your restim instances are looking for.
Go to Tools → Preferences → Funscript/T-Code, and change the values under the “Funscript Name” column to match the source script you’d like to use for that parameter. For example, you can have one restim instance dedicated to sensations on your legs, and change the alpha and beta axes to look for funscripts named “alpha_legs” and “beta_legs” respectivly. The possibilities are endless here and are limited only by your desire to script for them.

## Use

Once you’re all set up, all restim instances will be able to work off of the same media input, simultaneously. Perform all necessary calibration, and select your media player of choice (in all instances), or connect to Intiface Central.