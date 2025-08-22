---
title: Welcome to Matlock Fight Talk
layout: default
---
<center>
    <h2>Welcome to the Cage!</h2>
    <p><font color="#FFFFFF">Your home for MMA rants, trauma dumping, and half-assed fight analysis. Dive into the chaos!</font></p>
</center>
<div class="intro-container">
    <p><font color="#FFFFFF">Matlock Fight Talk is where the punches land and the opinions fly. Check out my latest <a href="/fighttalk">Fight Talk</a> posts for raw takes on UFC matchups, join the <a href="/chatroom">Chatroom</a> for live fight chatter, spin the <a href="/vegas">Vegas Slots</a> for some retro fun, or leave your mark in the <a href="/guestbook">Guestbook</a>.</font></p>
</div>
{% assign latest_post = site.posts | first %}
{% if latest_post %}
<div class="blog-post">
    <h3><a href="{{ latest_post.url }}">{{ latest_post.title }}</a></h3>
    <p class="post-date">{{ latest_post.date | date: "%B %d, %Y" }}</p>
    <p>{{ latest_post.excerpt }}</p>
</div>
{% endif %}
