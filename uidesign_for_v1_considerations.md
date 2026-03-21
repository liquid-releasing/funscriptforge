This topic includes cross referencew with funscript-tools and possible previous branches. We have implemented some of the features discuessed here.

# Thoughts on undo

Design princple: Save the results of each step to the project config after Accept on the tab.

# Not yet completed blue suggestion box

Fix the default blue tab that is displayed to direct to the tab name of the next thing to fix in the workflow. The name should be the name of the tab. [Currently it shows the 1 dot Project or similar]

# UI fix

Accept button on each page where you take action.
Should not have an arrow and does not need to select the next tab.
Advisory below the Accept button after processing completed saying something like "Your next item in the workflow is [Tab]"
Or even better? A mermaid diagramm that shows the workflow and someway to show completed items (black with white lettering) with uncompleted steps (white on black lettering)?

# Thoughts on output device selection

Move the set of device selection checkboxes to a new tab.

# thoughts on tone tab

We are trying to do two things on the Tone tab:

- Provide more interesting tone (curved or funnel or taper off at the end)
- Device awareness fixes

## Two suggestions

Addressing how to find a more interesting tone

I'm landing on the idea of the Tone tab offering two suggestions, rather than a single suggestion. Recommendation provides:

- Enhancing existing funscript
- Adding diversity, changing up the funscript to make it more interesting

First option allows the user to put off the changes to Phrases

The changes made for Tone should also reflect the recommendations around device awareness -- device maxes. 

There may be a backlog item to select tone based on some calculation. If we have a choice, we can abandon it. 

## Sliders

We should present the user with all of the sliders that were effecting. Sometimes there was one, sometimes two. Sometimes three. Was there a case of 4 sliders making significant decisions?

There should be a light description of what the slider does beyond the title. Under an info button?

## Tone impact

Lets's take the example of a tone that creates a funnel. There is a bunch of selections that control some stuff about the funnel. And they are interesting tweeks. But what I noticed most and wanted to change most was how narrow the start of the funnel was. In this case, the change at the beginning was so small that it would take away interest. I just wnated to make the initial part of the funnel bigger. 

So from a starting point with 20% stroke, it would start with 35 or 40. I think that idea applies across the tones. But I am not sure. Thoughts?

### UI Change

Add the impact slider to the others in Tone. Inpact sets how much of the tone you apply to the funscript.

### Project config consideration

Save the selection and maybe even the new funscript.

## Credit

Put a note that this page is "Incorporates the significant work of Edger's Funscript-Tools" and point to the Github repository

# Device selection

So what devices are we building for? And what is the workflow for building for each device? Or are we onesize fits all?

Let's select it in device awareness. If the user wants different funscripts for different devices, they start at the beginning again.

# Device awareness

The incoming funscript may or may not be ready. But what comes out of Tones should be. And that script should carry the original one's ideas. And where do we apply "the fix". I am slowly landing on the idea of making it right sooner rather than later.

VictoriaOaks is the first use case. How do we preserve the relentless beat? And what alternatives should we present and where?

Principle: 
- Device awareness should be applied globally initially
- User picks mitigation
- User can edit the phrases to fine tune the scripts
- Maintain the original beat

Issues is:

- Too big of a change in stroke too quickly.

Proposed fix, open for discussion.

These fixes are:

- Half strokes. Take the fast end to end and just slow them down, but keep end to end. (apply halve transform)
- Shorten the strokes. (apply amplitude just enough to make it device aware)
- Rebuild based on the beat [we developed a beat at the beginning!]

Apply gobally or apply to phrases

- Globally apply one of the fixes everywhere
- Apply the fixes to the errant phrases randomly. 
- Apply to phrases, on a rotating basis
- Apply to phrases on a random basis
- Not apply, but require a fix. we are doing it by work item. But I struggle to figure out in the current ui what to do.

Let's make device awareness easy.

At the top of the Phrases Selection tab, the user gets the alteratives for fixing errant areas of the scripts.

[X] Halve storkes [X] Shorten strokes [ ]  Beat
[ ] Apply to entire funscript [ ] Alternate by phrase [ ] Random by phrase <= user picks>

### UI Change

Give it it's own tab after Tone. "Device aweareness"

Design guideline: sections [Headline][Small description][Plotly]

New tabed named "Device"
- Device selection [checkbox for the list of output devices] moved from top of Output. [removed from Output on Projects tab]
- Phrase selection adjustment [ Phrase selection settings currently at the top of Phrase ]
- Beat bar plotly if available for reference. Available when we have a video or audio file.
- "Device awareness solution" section

[X] Performance [ ] Halve storkes [ ] Shorten strokes [ ]  Beat <- performance is the default
[ ] Apply to entire funscript [ ] Alternate by phrase [ ] Random by phrase 

- Sliders/no sliders? The fix is to preserve beat feeling, with the max stroke/timing value possible and keep device safe
- Plotly showing monochrome chart of the phrases with boxes around each phrases. Similar to the one we now use for selection. Adjacent to that the selected fix
- Accept button is disabled until device awareness solution is made

Accept button rebuild the phrase selection list and creates the full color representation for Phrase Selection. Wheel shows progress and counts the number of strokes (we call them something else) til completion.

Saves results to config file. Project file now includes the devices and the decisions made for device awareness

### Export change

We export the funscripts into a folder named for the device. 

C:\Users\bruce\Projects\funscriptforge\assets\output\Timeline1\handy
C:\Users\bruce\Projects\funscriptforge\assets\output\Timeline1\estim-foc
C:\Users\bruce\Projects\funscriptforge\assets\output\Timeline1\estim-stereo

### Open question

Fix before Tone? (I am leaning toware device fix before tone)

# throught on phrases

## Tone added

Radio button selector will have [Tone][Behavior][Structure][Plugins]

Add Tone as first selection in the Transform. So in the Transform, the default selection is the currently selected Tone, which should do no change. We should know that we have alrady applied the change. We should know this from the config file.

The dropdown will alter that section with the new Tone using its several Sliders, including Tone severity/impact as the top slider.

Preview works as currently laid out.

Missing something important?

## Video or audio player for the phrase

At some point, I recall we had a way to play the video or audio. It was in the upper right corner or perhaps it was above Transforms. You could see or hear the phrase you were working on (if the video was loaded). It may even be in this version. At one point, we had figured out placement.

Discuss?

## Should beat bar be added to the UI to help inform the transform selection

Should we show the beatbar? Where should it it go? Between the as is section and the preview section?

# Thoughts on catalog

Catalog should be visible whethere there is a funscript loaded or not

Tones to be added to the catalog at the top. (We actually did that in some version. so it might be available in another project or in one of the checkins. Or we can rebuild it)

1. Can the Catalog tab be added on the right side of the UI? 
2. if so, can we have a catalog tab for each catalog? One each for 

- Tone -> Tone Catalog
- Behavior -> Behavior Catalog
- Structural -> Structural Catalog
- Plugins -> Plugin Catalog
- Characteristics (Stim)

Did I miss one? Too many to fit>

# thoughts on retransform tab

checking that so far we have not built the alpha, beta, and the other funscripts. We just used tone to affect the main funscript. Is that correct?

Here are some comments for discussion about retransform.

We should rename this tab to something else. Estim? Enhancements? Alpha generation? If so it should only be available if estim is selected as the output device. This is the prep for estim. (named Stim perhaps?)

Reask the output devices checkbox.
Title box should fit the title.  
We have art so we don't need special icons. We actually have the plotly graph we can display. Interactive. User plays with sliders to see the curves change. 
Unlike the one that edger did, the scale shouldn't change on the chart (what is that chart called). The scale should be fixed and the size of the curve shown proporionally as you slide the sliders.
Only applies once you click select.

Question. Do these changes also change the main funscript? Or can we just show the main four funscripts that will be generated? There was a thought and maybe even some code to show four of the generated funscripts. With the last one selectable to show the others that are not shown. Or it is easier just to show them all.

### Device selection

All devices supported by Restim. Currently

- FOC [name should be the same as restim uses]
- Stereo
- some other I need to look up

### Other devices

 I can imagine a similar tab to estim/retransform for haptics. I don't think we need one for Handy. Unless there are Handy specific things to change? Some of the devices use alpha and beta channels. Which ones? and we already know a lot. and we have some pretty cool algorhytms we could take from edgers work? they should get their own panel if we have some idea of the math to use to creat those channels. Discussion?

### Credit here similar to Tones

Credit Edger. Keep the section on advanced

Let's figure out how Edger's advance output fits here. or we just say, save the funscript as input into Edger's Funscript-Tools.

### On Accept 

show the workflow diagram

## Thoughts on Export.

Copy input media to output folder
Show output folder location.

After the user clicks Apply, wheel shows generation. On completion, [Open File Location in Windows Explorer/Finder/cd to command line?/ whatever linux uses]

 ## thoughts on a new tab Play

 This is a next step where we can show how to get information on how to play the scripts. 

 With text that says SyncPlayer is coming soon. (Or to make it part of this release actually)