---
title: Fight Talk!
---
<center>
    <h2>Fight Talk! </h2>
    <p><font color="#FFFFFF">Trauma Dumping and Half-Assed Analysis</font></p>
</center>

{% for post in site.posts %}
<div class="blog-post">
    <h3><a href="{{ post.url }}">{{ post.title }}</a></h3>
    <p><font color="#825b5b">{{ post.date | date: "%B %d, %Y" }}</font></p>
    <p>{{ post.excerpt }}</p>
</div>
{% endfor %}
