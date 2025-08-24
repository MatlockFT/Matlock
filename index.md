---
title: MATLOCK'S FIGHT TALK
layout: default
---
<center>
    <h2>WHERE ARE YOU?</h2>
    <div class="intro-container">
        <p><font color="#FFFFFF">You're here at the end of the internet. It's not much, I know... However! You can check out my fight analysis. Sure, it may have some trauma dumping mixed in but at least you'll get some enjoyable content out of it. Maybe.</font></p>
    </div>
    <p><font color="#FFFFFF">For fight breakdowns, check out <a href="/matlockpapers">The Matlock Papers</a> on your left. I'll host watchalongs on fight nights so be sure to join the <a href="/chatroom">Chatroom</a> for the livestream and chatter, spin the <a href="/vegas">Vegas Slots</a> to waste time, or leave your mark in the <a href="/guestbook">Guestbook</a>.</font></p>
</center>

{% assign latest_post = site.posts | first %}
{% if latest_post %}
<div class="blog-post">
    <h3><a href="{{ latest_post.url }}">{{ latest_post.title }}</a></h3>
    <p class="post-date">{{ latest_post.date | date: "%B %d, %Y" }}</p>
    <p>{{ latest_post.excerpt }}</p>
</div>
{% endif %}
