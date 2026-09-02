# Wispace

A flexible money saving app built to take the pressure out of budgeting.
You set a goal, pick a rhythm that fits your life, and Wispace keeps the plan
honest as real life happens.

## Running it

Open `index.html` in a browser. That's it — no install, no build step, no
server. Everything you create is stored in that browser, so your goals are
still there next time you open the file.

## What's in it

**Intro → Sign in** — make a profile with your name, email and the currency
you save in (CAD, USD or EUR).

**Home** — a progress circle per goal, dragged left and right when you have
more than one. Under it sits the check-in strip, which you can also drag
through your whole plan, and a deposit button.

**Goals** — as many goals as you want. Set a target amount and a deadline,
and the app works out what you'd need to put in daily, weekly, every two
weeks, monthly, every six months or yearly. Pick the rhythm you like, then
change the amount if you want to. If the amount and the deadline don't line
up, the app offers a few ways to fix it that you can apply with one tap.

**History** — every deposit and withdrawal, plus anything you log by hand
from outside your goals. Filter by goals or outside entries, delete an entry
if you got it wrong.

**Profile** — your details, currency, reminders, and a few totals.

## How the recalculating works

Your contribution amount is the thing that stays put; the finish date is what
moves. Put in more than planned and the date pulls forward, put in less and
it slides back. The deposit screen tells you the new date before you confirm.

Currency switching relabels amounts, it doesn't convert them — there are no
exchange rates in here, so a 200 goal stays 200 whichever currency you pick.

## Files

    index.html    every screen
    styles.css    all the styling
    app.js        the logic - saving, maths, and rendering

## Note

This is a design project, not a real banking app. The sign-in isn't real
security: there's no server, so the email and password only ever live in your
own browser.
