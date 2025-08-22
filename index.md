---
title: Fight Talk!
---
<center>
    <h2>Fight Talk! Blog</h2>
    <p><font color="#FFFFFF">Hard-hitting MMA analysis, breakdowns, and predictions!</font></p>
</center>

{% for post in site.posts %}
<div class="blog-post">
    <h3><a href="{{ post.url }}">{{ post.title }}</a></h3>
    <p><font color="#CC0000">{{ post.date | date: "%B %d, %Y" }}</font></p>
    <p>{{ post.excerpt }}</p>
</div>
{% endfor %}
